'use strict';

const crypto = require('node:crypto');
const staffRoles = ['owner', 'manager', 'team_leader', 'agent'];
const roleOrder = new Map([['manager', 0], ['team_leader', 1], ['agent', 2], ['owner', 3]]);
const fail = code => { throw Object.assign(new Error(code), { code }); };

function parseYes(value) {
  const text = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const match = text.match(/^(?:yes|y|available|i can take(?: it)?|i am available|i'm available|نعم|متاح|متاحة)\s+([a-z][0-9]|[a-z0-9]{6})[.!؟]?$/iu);
  return match ? { code: String(match[1]).toUpperCase() } : null;
}

function phone(value, normalizer = require('./business-whatsapp').phone) {
  const raw = String(value || '').replace(/@(s\.whatsapp\.net|c\.us)$/i, '');
  return normalizer(raw);
}

async function codeIsRegistered(db, tenantId, code) {
  const [rows] = await db.query(`SELECT id FROM sx_chatbot_handoff_code_registry
    WHERE tenant_id=? AND claim_code=? LIMIT 1 FOR UPDATE`, [tenantId, code]);
  return Array.isArray(rows) && rows.length > 0;
}

async function newCode(db, tenantId, preferShort, unavailable = new Set()) {
  const count = 26 * 10;
  if (preferShort) {
    const start = crypto.randomInt(count);
    for (let offset = 0; offset < count; offset++) {
      const value = (start + offset) % count;
      const code = String.fromCharCode(65 + Math.floor(value / 10)) + String(value % 10);
      if (!unavailable.has(code) && !await codeIsRegistered(db, tenantId, code)) return code;
    }
  }
  // Never recycle a short code: old staff alerts may still be visible in WhatsApp.
  // Keep handoffs available with a longer code only after the tenant uses all 260 short codes.
  for (let attempt = 0; attempt < 32; attempt++) {
    const code = crypto.randomInt(36 ** 6).toString(36).toUpperCase().padStart(6, '0');
    if (!unavailable.has(code) && !await codeIsRegistered(db, tenantId, code)) return code;
  }
  fail('HANDOFF_CODE_POOL_EXHAUSTED');
}

function isCodeCollision(error) {
  const detail = `${error?.sqlMessage || ''} ${error?.message || ''}`.toLowerCase();
  return error?.code === 'ER_DUP_ENTRY'
    && /uq_sx_chatbot_handoff_code(?:_registry_code)?(?:['`]|$)/.test(detail);
}

function oneHourTenant() {
  return process.env.SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID || null;
}

function holdMinutes(tenantId, profileOrConfig = null) {
  const config = profileOrConfig?.config || profileOrConfig;
  const configured = Number(config?.staffHandoffTimeoutMinutes);
  if ([15, 30, 60, 1440].includes(configured)) return configured;
  if (tenantId && tenantId === oneHourTenant()) return 60;
  return 1440;
}

async function expireDue(pool, { tenantId = null, channelKind = null, channelRef = null, conversationId = null, limit = 100, resetAll = false, beforeReset = null } = {}) {
  const scopedTenant = oneHourTenant();
  if (resetAll && (!tenantId || tenantId !== scopedTenant)) fail('HANDOFF_RESET_SCOPE_REQUIRED');
  if (resetAll && typeof beforeReset !== 'function') fail('HANDOFF_RESET_SNAPSHOT_REQUIRED');
  const expiry = 'COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))';
  const clauses = ["status IN ('open','claimed')"];
  const args = [];
  if (!resetAll) clauses.push(`${expiry}<=UTC_TIMESTAMP(3)`);
  if (tenantId) { clauses.push('tenant_id=?'); args.push(tenantId); }
  if (channelKind) { clauses.push('channel_kind=?'); args.push(channelKind); }
  if (channelRef) { clauses.push('channel_ref=?'); args.push(channelRef); }
  if (conversationId) { clauses.push('conversation_id=?'); args.push(conversationId); }
  limit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const db = await pool.getConnection();
  const totals = { expired: 0, controlsReset: 0, guidedSessionsReset: 0, flowSessionsReset: 0, tasksCanceled: 0, deliveriesSuppressed: 0, relayDeliveriesSuppressed: 0 };
  try {
    await db.beginTransaction();
    const [rows] = await db.query(`SELECT id,tenant_id AS tenantId,profile_id AS profileId,channel_kind AS channelKind,channel_ref AS channelRef,
      conversation_id AS conversationId,owner_uid_hash AS ownerUidHash,handoff_task_id AS handoffTaskId,
        notification_event_key AS notificationEventKey,status,reason
      FROM sx_chatbot_handoff_claims WHERE ${clauses.join(' AND ')}
      ORDER BY expires_at,id LIMIT ? FOR UPDATE${conversationId || resetAll ? '' : ' SKIP LOCKED'}`, [...args, limit]);
    if (resetAll) await beforeReset(db, rows);
    for (const claim of rows) {
      let flowSessionResetCount = 0;
      const timedHandoff = claim.status === 'claimed';
      await db.query(`UPDATE sx_chatbot_handoff_claims SET status='expired',revision=revision+1
        WHERE tenant_id=? AND id=?`, [claim.tenantId, claim.id]);
      totals.expired++;
      const [relayDeliveries] = await db.query(`UPDATE sx_chatbot_handoff_relay_deliveries
        SET status='suppressed',last_error_code='HANDOFF_EXPIRED',payload_ciphertext=NULL,payload_iv=NULL,payload_auth_tag=NULL
        WHERE tenant_id=? AND claim_id=? AND status='pending'`, [claim.tenantId, claim.id]);
      totals.relayDeliveriesSuppressed += Number(relayDeliveries.affectedRows || 0);
      const [control] = await db.query(`UPDATE sx_chatbot_conversation_controls c
        JOIN sx_chatbot_handoff_claims h ON h.id=? AND h.tenant_id=c.tenant_id
        SET c.mode='inherit',c.pause_until=NULL,c.reason=NULL,
          c.revision=c.revision+1,c.updated_by_kind='system',c.updated_by_identity_id=NULL
        WHERE c.tenant_id=? AND c.channel_kind=? AND c.channel_ref=? AND c.conversation_id=? AND c.mode='paused'
          AND ((c.updated_by_kind='system' AND IF(?, BINARY c.reason=BINARY h.reason,
                c.pause_until IS NULL OR c.pause_until<=UTC_TIMESTAMP(3)))
            OR (? AND c.updated_by_kind='identity' AND c.updated_by_identity_id=h.claimed_identity_id
                AND (BINARY c.reason=BINARY h.reason OR BINARY c.reason=BINARY CONCAT('staff-handoff:',h.id)
                  OR (h.relay_enabled=1 AND BINARY c.reason=BINARY CONCAT('staff-handoff-relay:',h.id)))
                AND (c.updated_at=h.claimed_at OR (? AND c.pause_until IS NULL
                  AND ABS(TIMESTAMPDIFF(MICROSECOND,c.updated_at,h.claimed_at))<1000000))))`,
      [claim.id, claim.tenantId, claim.channelKind, claim.channelRef, claim.conversationId,
        timedHandoff, timedHandoff && claim.status === 'claimed', resetAll]);
      totals.controlsReset += Number(control.affectedRows || 0);
      let guidedSession = { affectedRows: 0 };
      if (Number(control.affectedRows || 0) === 1 || resetAll) {
        [guidedSession] = await db.query(`DELETE FROM sx_chatbot_guided_sessions
          WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`,
        [claim.tenantId, claim.profileId, claim.channelKind, claim.channelRef, claim.conversationId]);
      }
      totals.guidedSessionsReset += Number(guidedSession.affectedRows || 0);
      const [[profile]] = await db.query(`SELECT engine,config FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? LIMIT 1`,
        [claim.tenantId, claim.profileId]);
      const [[chat]] = await db.query(`SELECT uid,sender_mobile AS senderMobile,origin FROM beta_chats
        WHERE BINARY chat_id=BINARY ? AND BINARY SHA2(uid,256)=BINARY ? LIMIT 1`, [claim.conversationId, claim.ownerUidHash]);
      let profileConfig = profile?.config;
      try { if (typeof profileConfig === 'string') profileConfig = JSON.parse(profileConfig); } catch { profileConfig = null; }
      if ((Number(control.affectedRows || 0) === 1 || resetAll) && profile?.engine === 'guided' && profileConfig?.flowId && chat?.uid && chat?.senderMobile) {
        const flowId = require('./chatbot-profile-utils').executionFlowId({
          id: claim.profileId, channelRef: claim.channelRef,
        });
        const flowOrigin = chat.origin === 'qr' ? 'qr' : 'meta';
        const flowOriginId = flowOrigin === 'qr' ? claim.channelRef : 'META';
        const [flowSession] = await db.query(`DELETE FROM flow_session
          WHERE uid=? AND origin=? AND origin_id=? AND flow_id=? AND sender_mobile=?`,
        [chat.uid, flowOrigin, flowOriginId, flowId, chat.senderMobile]);
        flowSessionResetCount = Number(flowSession.affectedRows || 0);
        totals.flowSessionsReset += flowSessionResetCount;
      }
      if (claim.handoffTaskId) {
        const [[task]] = await db.query(`SELECT status,revision FROM sx_tasks WHERE tenant_id=? AND id=?
          AND uid_hash=? AND task_type='chatbot_handoff' AND deleted_at IS NULL FOR UPDATE`,
        [claim.tenantId, claim.handoffTaskId, claim.ownerUidHash]);
        if (task && ['open', 'in_progress', 'blocked'].includes(task.status)) {
          const revision = Number(task.revision) + 1;
          const [updated] = await db.query(`UPDATE sx_tasks SET status='canceled',completed_at=NULL,revision=?
            WHERE tenant_id=? AND id=? AND revision=? AND status IN ('open','in_progress','blocked') AND deleted_at IS NULL`,
          [revision, claim.tenantId, claim.handoffTaskId, task.revision]);
          if (updated.affectedRows) {
            await db.query(`INSERT INTO sx_task_events(tenant_id,task_id,revision,actor_type,actor_id,event_type,from_status,to_status,details_json)
              VALUES (?,?,?,'system',NULL,'status_changed',?,'canceled',?)`,
            [claim.tenantId, claim.handoffTaskId, revision, task.status, JSON.stringify({ reason: resetAll ? 'chatbot-handoff-operator-reset' : 'chatbot-handoff-expired', afterMinutes: holdMinutes(claim.tenantId, profileConfig) })]);
            totals.tasksCanceled++;
          }
        }
      }
      if (claim.notificationEventKey) {
        const [deliveries] = await db.query(`UPDATE sx_business_notification_deliveries d
          JOIN sx_business_notification_events e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
          SET d.status='suppressed',d.error_code='HANDOFF_EXPIRED'
          WHERE e.tenant_id=? AND e.event_key=? AND e.kind='chatbot_handoff' AND d.status IN ('queued','blocked')`,
        [claim.tenantId, claim.notificationEventKey]);
        totals.deliveriesSuppressed += Number(deliveries.affectedRows || 0);
        await db.query(`UPDATE sx_business_notification_events SET status='failed',last_error_code='HANDOFF_EXPIRED'
          WHERE tenant_id=? AND event_key=? AND kind='chatbot_handoff' AND status IN ('queued','prepared')`,
        [claim.tenantId, claim.notificationEventKey]);
      }
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,NULL,'system','chatbot.handoff-expired','chatbot-handoff',?,?,?)`,
      [crypto.randomUUID(), claim.tenantId, claim.id,
        JSON.stringify({ channelKind: claim.channelKind, result: resetAll ? 'operator-reset' : 'deadline-reached', afterMinutes: holdMinutes(claim.tenantId, profileConfig), controlReset: Number(control.affectedRows || 0) === 1,
          guidedSessionReset: Number(guidedSession.affectedRows || 0) === 1, flowSessionsReset: flowSessionResetCount }),
        crypto.randomUUID()]);
    }
    await db.commit();
    return totals;
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function resetForCustomerGreeting(pool, { tenantId, uid, channelKind, channelRef, conversationId }) {
  if (!tenantId || !uid || !conversationId || !['whatsapp_meta', 'whatsapp_qr'].includes(channelKind) || !channelRef) return false;
  const ownerUidHash = crypto.createHash('sha256').update(uid).digest('hex');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[claim]] = await db.query(`SELECT id,owner_uid_hash AS ownerUidHash,handoff_task_id AS handoffTaskId,
        notification_event_key AS notificationEventKey
      FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=?
        AND conversation_id=? AND owner_uid_hash=? AND status='open' FOR UPDATE`,
    [tenantId, channelKind, channelRef, conversationId, ownerUidHash]);
    const [[control]] = await db.query(`SELECT mode,reason,updated_by_kind AS updatedByKind,
        (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)) AS isActive
      FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND channel_kind=? AND channel_ref=?
        AND conversation_id=? FOR UPDATE`, [tenantId, channelKind, channelRef, conversationId]);
    const activeSystemPause = control?.mode === 'paused' && control.updatedByKind === 'system' && control.reason !== 'staff-replied' && Number(control.isActive) === 1;
    if (!activeSystemPause) {
      await db.commit();
      return false;
    }

    const [resumed] = await db.query(`UPDATE sx_chatbot_conversation_controls SET mode='inherit',pause_until=NULL,reason=NULL,
        revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL
      WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND mode='paused'
        AND updated_by_kind='system' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3))`,
    [tenantId, channelKind, channelRef, conversationId]);
    if (resumed.affectedRows !== 1) {
      await db.commit();
      return false;
    }

    let claimExpired = false;
    if (claim) {
      const [expired] = await db.query(`UPDATE sx_chatbot_handoff_claims SET status='expired',expires_at=UTC_TIMESTAMP(3),revision=revision+1
        WHERE tenant_id=? AND id=? AND status='open'`, [tenantId, claim.id]);
      claimExpired = expired.affectedRows === 1;
      if (claimExpired) {
        if (claim.handoffTaskId) {
          const [[task]] = await db.query(`SELECT status,revision FROM sx_tasks WHERE tenant_id=? AND id=?
            AND uid_hash=? AND task_type='chatbot_handoff' AND deleted_at IS NULL FOR UPDATE`,
          [tenantId, claim.handoffTaskId, ownerUidHash]);
          if (task && ['open', 'in_progress', 'blocked'].includes(task.status)) {
            const revision = Number(task.revision) + 1;
            const [updated] = await db.query(`UPDATE sx_tasks SET status='canceled',completed_at=NULL,revision=?
              WHERE tenant_id=? AND id=? AND revision=? AND status IN ('open','in_progress','blocked') AND deleted_at IS NULL`,
            [revision, tenantId, claim.handoffTaskId, task.revision]);
            if (updated.affectedRows) await db.query(`INSERT INTO sx_task_events(tenant_id,task_id,revision,actor_type,actor_id,event_type,from_status,to_status,details_json)
              VALUES (?,?,?,'system',NULL,'status_changed',?,'canceled',?)`,
            [tenantId, claim.handoffTaskId, revision, task.status, JSON.stringify({ reason: 'customer-restarted-chat' })]);
          }
        }
        if (claim.notificationEventKey) {
          await db.query(`UPDATE sx_business_notification_deliveries d
            JOIN sx_business_notification_events e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
            SET d.status='suppressed',d.error_code='HANDOFF_CUSTOMER_RESTARTED'
            WHERE e.tenant_id=? AND e.event_key=? AND e.kind='chatbot_handoff' AND d.status IN ('queued','blocked')`,
          [tenantId, claim.notificationEventKey]);
          await db.query(`UPDATE sx_business_notification_events SET status='failed',last_error_code='HANDOFF_CUSTOMER_RESTARTED'
            WHERE tenant_id=? AND event_key=? AND kind='chatbot_handoff' AND status IN ('queued','prepared')`,
          [tenantId, claim.notificationEventKey]);
        }
      }
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,NULL,'system','chatbot.handoff-customer-restarted','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), tenantId, conversationId,
      JSON.stringify({ channelKind, claimExpired, result: 'customer-restarted-with-greeting' }), crypto.randomUUID()]);
    await db.commit();
    return true;
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function open(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason, brief = {} }) {
  if (!ctx?.tenant?.id || !profile?.id || !uid || !chatId || !['whatsapp_qr', 'whatsapp_meta'].includes(channelKind) || !channelRef) fail('HANDOFF_INVALID_CONTEXT');
  const ownerHash = crypto.createHash('sha256').update(uid).digest('hex');
  const claimWindowMinutes = holdMinutes(ctx.tenant.id, profile);
  const [[existing]] = await db.query(`SELECT id,claim_code AS claimCode,status,revision,reason,notification_event_key AS notificationEventKey,
      (COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)) AS isActive
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`,
  [ctx.tenant.id, channelKind, channelRef, chatId]);
  if (Number(existing?.isActive) && ['open', 'claimed'].includes(existing.status)) {
    return { ...existing, created: false };
  }
  const id = existing?.id || crypto.randomUUID();
  const revision = Number(existing?.revision || 0) + 1;
  const eventKey = `chatbot-handoff:${id}:${revision}`;
  let claimCode = null;
  let claimRowWritten = false;
  let written = false;
  const unavailableCodes = new Set();
  const preferShort = profile?.config?.shortHandoffCodesEnabled === true;
  if (preferShort) {
    const [[tenantLock]] = await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE', [ctx.tenant.id]);
    if (!tenantLock) fail('HANDOFF_TENANT_NOT_FOUND');
  }
  for (let attempt = 0; attempt < 32; attempt++) {
    claimCode = await newCode(db, ctx.tenant.id, preferShort, unavailableCodes);
    try {
      if (existing || claimRowWritten) {
        await db.query(`UPDATE sx_chatbot_handoff_claims SET profile_id=?,owner_uid_hash=?,claim_code=?,reason=?,status='open',
          expires_at=TIMESTAMPADD(MINUTE,?,UTC_TIMESTAMP(3)),
          handoff_task_id=NULL,notification_event_key=?,claimed_identity_id=NULL,claimed_at=NULL,last_customer_ack_at=NULL,
          last_customer_ack_inbound_id=NULL,customer_name=?,customer_phone=?,course_details=?,latest_enquiry=?,summary_context=?,ai_summary=NULL,
          ai_summary_status='pending',ai_summary_lease_until=NULL,ai_summary_attempts=0,relay_enabled=0,closed_at=NULL,closed_identity_id=NULL,revision=? WHERE tenant_id=? AND id=?`,
        [profile.id, ownerHash, claimCode, String(reason || 'human-review').slice(0, 120), claimWindowMinutes, eventKey,
          brief.customerName || null, brief.customerPhone || null, JSON.stringify(brief.courseDetails || []), brief.latestEnquiry || null,
          brief.summaryContext ? JSON.stringify(brief.summaryContext) : null, revision, ctx.tenant.id, id]);
        claimRowWritten = true;
      } else {
        await db.query(`INSERT INTO sx_chatbot_handoff_claims(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,owner_uid_hash,claim_code,reason,expires_at,notification_event_key,customer_name,customer_phone,course_details,latest_enquiry,summary_context,revision)
          VALUES (?,?,?,?,?,?,?,?,?,TIMESTAMPADD(MINUTE,?,UTC_TIMESTAMP(3)),?,?,?,?,?,?,?)`,
        [id, ctx.tenant.id, profile.id, channelKind, channelRef, chatId, ownerHash, claimCode, String(reason || 'human-review').slice(0, 120), claimWindowMinutes, eventKey,
          brief.customerName || null, brief.customerPhone || null, JSON.stringify(brief.courseDetails || []), brief.latestEnquiry || null,
          brief.summaryContext ? JSON.stringify(brief.summaryContext) : null, revision]);
        claimRowWritten = true;
      }
      await db.query(`INSERT INTO sx_chatbot_handoff_code_registry(id,tenant_id,claim_code,claim_id,revision)
        VALUES (?,?,?,?,?)`, [crypto.randomUUID(), ctx.tenant.id, claimCode, id, revision]);
      written = true;
      break;
    } catch (error) {
      if (!isCodeCollision(error)) throw error;
      unavailableCodes.add(claimCode);
    }
  }
  if (!written) fail('HANDOFF_CODE_ALLOCATION_FAILED');
  return { id, claimCode, revision, notificationEventKey: eventKey, created: true };
}

async function queue(db, tenantId, claim) {
  return require('./business-notifications').enqueue(db, tenantId, {
    kind: 'chatbot_handoff', sourceType: 'chatbot_handoff', sourceId: claim.id,
    key: claim.notificationEventKey, payload: { claimCode: claim.claimCode, revision: claim.revision },
  });
}

async function appendCallbackTask(db, { tenantId, taskId, callbackNumber, courseName, requestKey }) {
  if (!tenantId || !taskId || !callbackNumber || !requestKey) return false;
  const [[task]] = await db.query(`SELECT description,status,revision FROM sx_tasks
    WHERE tenant_id=? AND id=? AND task_type='chatbot_handoff' AND deleted_at IS NULL FOR UPDATE`, [tenantId, taskId]);
  if (!task) return false;
  const marker = `Callback request confirmed [${requestKey}]`;
  if (String(task.description || '').includes(marker)) return false;
  const line = `${marker}: customer agreed to a coordinator call at ${callbackNumber}${courseName ? ` about ${courseName}` : ''}.`;
  const priorDescription = String(task.description || '').replace(
    /The assistant continues helping while staff are notified\. After a staff reply in Inbox, it pauses for the bot’s selected interval and resumes automatically\./u,
    'The assistant is paused while this handoff is active.');
  const description = [priorDescription.trim(), line].filter(Boolean).join('\n\n').slice(0, 60000);
  const revision = Number(task.revision || 0) + 1;
  const [updated] = await db.query(`UPDATE sx_tasks SET description=?,revision=? WHERE tenant_id=? AND id=? AND revision=? AND deleted_at IS NULL`,
    [description, revision, tenantId, taskId, task.revision]);
  if (updated.affectedRows !== 1) return false;
  await db.query(`INSERT INTO sx_task_events(tenant_id,task_id,revision,actor_type,actor_id,event_type,from_status,to_status,details_json)
    VALUES (?,?,?,'system',NULL,'callback_requested',?,?,?)`,
  [tenantId, taskId, revision, task.status, task.status, JSON.stringify({ callbackNumber, courseName: courseName || null, requestKey })]);
  return true;
}

async function confirmCallback(db, { ctx, profile, uid, chatId, channelKind, channelRef, brief = {}, callbackNumber, courseName, requestKey }) {
  if (!callbackNumber || !/^[+]974[3567]\d{7}$/.test(callbackNumber) || !/^[a-f0-9]{24}$/i.test(String(requestKey || ''))) {
    fail('CALLBACK_CONFIRMATION_INVALID');
  }
  const ownerHash = crypto.createHash('sha256').update(uid).digest('hex');
  const [[existing]] = await db.query(`SELECT id,claim_code AS claimCode,status,revision,reason,
      notification_event_key AS notificationEventKey,handoff_task_id AS handoffTaskId,
      (COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)) AS isActive
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?
      AND owner_uid_hash=? FOR UPDATE`, [ctx.tenant.id, channelKind, channelRef, chatId, ownerHash]);
  const marker = `Callback confirmed: customer agreed to a coordinator call at ${callbackNumber}${courseName ? ` for ${courseName}` : ''}.`;
  const latestEnquiry = [String(brief.latestEnquiry || '').trim(), marker].filter(Boolean).join('\n').slice(0, 1000);
  const summary = `The customer confirmed a course coordinator callback to ${callbackNumber}${courseName ? ` about ${courseName}` : ''}. Please call the customer to follow up.`.slice(0, 580);
  let claim = existing && Number(existing.isActive) && ['open', 'claimed'].includes(existing.status)
    ? { ...existing, created: false } : await open(db, { ctx, profile, uid, chatId, channelKind, channelRef,
      reason: 'qatar-coordinator-callback', brief: { ...brief, latestEnquiry } });
  if (!claim?.id) fail('CALLBACK_HANDOFF_UNAVAILABLE');
  const eventKey = `chatbot-handoff:${claim.id}:callback:${requestKey}`;
  const details = JSON.stringify(brief.courseDetails || []);
  if (claim.created) {
    await db.query(`UPDATE sx_chatbot_handoff_claims SET notification_event_key=?,customer_name=COALESCE(?,customer_name),
      customer_phone=COALESCE(?,customer_phone),course_details=IF(JSON_LENGTH(?)>0,?,course_details),latest_enquiry=?,
      summary_context=NULL,ai_summary=?,ai_summary_status='fallback',ai_summary_lease_until=NULL
      WHERE tenant_id=? AND id=?`, [eventKey, brief.customerName || null, brief.customerPhone || null, details, details,
      latestEnquiry, summary, ctx.tenant.id, claim.id]);
  } else {
    if (claim.status === 'open' && claim.notificationEventKey && claim.notificationEventKey !== eventKey) {
      await db.query(`UPDATE sx_business_notification_deliveries d JOIN sx_business_notification_events e
          ON e.tenant_id=d.tenant_id AND e.id=d.event_id
        SET d.status='suppressed',d.error_code='HANDOFF_UPDATED_WITH_CALLBACK_CONSENT'
        WHERE e.tenant_id=? AND e.event_key=? AND e.kind='chatbot_handoff' AND d.status IN ('queued','blocked')`,
      [ctx.tenant.id, claim.notificationEventKey]);
      await db.query(`UPDATE sx_business_notification_events SET status='failed',last_error_code='HANDOFF_UPDATED_WITH_CALLBACK_CONSENT'
        WHERE tenant_id=? AND event_key=? AND kind='chatbot_handoff' AND status IN ('queued','prepared')`,
      [ctx.tenant.id, claim.notificationEventKey]);
    }
    await db.query(`UPDATE sx_chatbot_handoff_claims SET reason='qatar-coordinator-callback',notification_event_key=?,
      customer_name=COALESCE(?,customer_name),customer_phone=COALESCE(?,customer_phone),
      course_details=IF(JSON_LENGTH(?)>0,?,course_details),latest_enquiry=?,summary_context=NULL,
      ai_summary=?,ai_summary_status='fallback',ai_summary_lease_until=NULL
      WHERE tenant_id=? AND id=? AND status IN ('open','claimed')`,
    [eventKey, brief.customerName || null, brief.customerPhone || null, details, details, latestEnquiry,
      summary, ctx.tenant.id, claim.id]);
  }
  const [[current]] = await db.query(`SELECT id,claim_code AS claimCode,status,revision,handoff_task_id AS handoffTaskId
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND id=?`, [ctx.tenant.id, claim.id]);
  const notificationQueued = current.status === 'open';
  if (notificationQueued) await queue(db, ctx.tenant.id, { ...current, notificationEventKey: eventKey });
  if (current.handoffTaskId) await appendCallbackTask(db, { tenantId: ctx.tenant.id, taskId: current.handoffTaskId,
    callbackNumber, courseName, requestKey });
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,NULL,'system','chatbot.callback-consent-confirmed','chatbot-handoff',?,?,?)`,
  [crypto.randomUUID(), ctx.tenant.id, claim.id, JSON.stringify({ requestKey, callbackNumber, courseName: courseName || null,
    notificationQueued, alreadyAssigned: current.status === 'claimed' }), crypto.randomUUID()]);
  return { ...claim, ...current, notificationEventKey: eventKey, callbackNotificationQueued: notificationQueued,
    callbackAssigned: current.status === 'claimed' };
}

async function findOpen(db, { tenantId, uid, channelKind, channelRef, chatId }) {
  const [[row]] = await db.query(`SELECT id,claim_code AS claimCode,status,reason,notification_event_key AS notificationEventKey,
      last_customer_ack_at AS lastCustomerAckAt,last_customer_ack_inbound_id AS lastCustomerAckInboundId
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND owner_uid_hash=? AND status='open'
      AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3) LIMIT 1`,
  [tenantId, channelKind, channelRef, chatId, crypto.createHash('sha256').update(uid).digest('hex')]);
  return row || null;
}

async function reserveCustomerAcknowledgement(pool, { tenantId, claimId, inboundId }) {
  const db = await pool.getConnection();
  try {
    const [result] = await db.query(`UPDATE sx_chatbot_handoff_claims SET last_customer_ack_at=UTC_TIMESTAMP(3),last_customer_ack_inbound_id=?
      WHERE tenant_id=? AND id=? AND status='open' AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)
        AND (last_customer_ack_inbound_id IS NULL OR last_customer_ack_inbound_id<>?)
        AND last_customer_ack_at IS NULL`,
    [inboundId, tenantId, claimId, inboundId]);
    return result.affectedRows === 1;
  } finally { db.release(); }
}

async function releaseCustomerAcknowledgement(pool, { tenantId, claimId, inboundId }) {
  await pool.query(`UPDATE sx_chatbot_handoff_claims SET last_customer_ack_at=NULL,last_customer_ack_inbound_id=NULL
    WHERE tenant_id=? AND id=? AND status='open' AND last_customer_ack_inbound_id=?`, [tenantId, claimId, inboundId]);
}

async function handleStaffClaim(pool, { ctx, profileId = null, relayEnabled = false, uid, message, text, channelKind, channelRef, chatId }) {
  const parsed = parseYes(text);
  if (!parsed) return { handled: false };
  const db = await pool.getConnection();
  let outcome;
  try {
    await db.beginTransaction();
    const qr = require('./business-whatsapp');
    const assignment = require('./team-conversation-assignment');
    const [[tenant]] = await db.query('SELECT timezone FROM sx_tenants WHERE id=? LIMIT 1', [ctx.tenant.id]);
    const countryCode = tenant?.timezone === 'Asia/Qatar' ? '974' : undefined;
    const allPhones = await qr.staff(db, ctx.tenant.id, { roles: staffRoles });
    const permitted = await assignment.eligibleStaff(db, ctx.tenant.id);
    const eligibleIds = new Set(permitted.map(member => member.identityId));
    const from = qr.phone(message?.senderMobile, { countryCode });
    const matches = allPhones.filter(member => member.phone && qr.phone(member.phone, { countryCode }) === from && eligibleIds.has(member.id));
    if (matches.length > 1) { await db.commit(); return { handled: true, outcome: 'ambiguous_staff' }; }
    if (!matches.length) { await db.commit(); return { handled: false }; }
    matches.sort((a, b) => (roleOrder.get(a.role) ?? 9) - (roleOrder.get(b.role) ?? 9) || a.id.localeCompare(b.id));
    const staffIdentity = matches[0];
    const ownerHash = crypto.createHash('sha256').update(uid).digest('hex');
    const [openClaims] = await db.query(`SELECT id,claim_code AS claimCode,conversation_id AS conversationId,profile_id AS profileId,reason,notification_event_key AS notificationEventKey
      FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND owner_uid_hash=? AND channel_kind=? AND channel_ref=? AND status='open'
        AND (? IS NULL OR profile_id=?)
        AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)
      ORDER BY created_at,id FOR UPDATE`, [ctx.tenant.id, ownerHash, channelKind, channelRef, profileId, profileId]);
    if (!openClaims.length) { await db.commit(); return { handled: true, outcome: 'none' }; }
    let claim;
    if (parsed.code) claim = openClaims.find(item => item.claimCode === parsed.code) || null;
    else if (openClaims.length === 1) claim = openClaims[0];
    if (!claim) {
      await db.commit();
      return { handled: true, outcome: parsed.code ? 'not_found' : 'ambiguous' };
    }
    const [[customerChat]] = await db.query(`SELECT sender_mobile AS senderMobile,sender_name AS senderName,origin
      FROM beta_chats WHERE uid=? AND chat_id=? FOR UPDATE`, [uid, claim.conversationId]);
    if (!customerChat?.senderMobile) { await db.rollback(); return { handled: true, outcome: 'chat_missing' }; }
    await assignment.assignConversation(db, { ctx, uid, chatId: claim.conversationId, identityId: staffIdentity.id, reason: 'bot-handoff-claimed' });
    const useRelay = relayEnabled === true && channelKind === 'whatsapp_qr' && claim.profileId === profileId;
    const [updated] = await db.query(`UPDATE sx_chatbot_handoff_claims SET status='claimed',claimed_identity_id=?,claimed_at=UTC_TIMESTAMP(3),
        expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),relay_enabled=?,closed_at=NULL,closed_identity_id=NULL
      WHERE tenant_id=? AND id=? AND status='open'`, [staffIdentity.id, useRelay ? 1 : 0, ctx.tenant.id, claim.id]);
    if (updated.affectedRows !== 1) { await db.rollback(); return { handled: true, outcome: 'already_claimed' }; }
    if (useRelay) {
      const reason = `staff-handoff-relay:${claim.id}`;
      const [[control]] = await db.query(`SELECT mode,reason,updated_by_kind AS updatedByKind,updated_by_identity_id AS updatedByIdentityId
        FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`,
      [ctx.tenant.id, channelKind, channelRef, claim.conversationId]);
      const canReplace = !control || control.mode !== 'paused'
        || (control.updatedByKind === 'system' && control.reason === claim.reason)
        || (control.updatedByKind === 'identity' && control.updatedByIdentityId === staffIdentity.id && control.reason === reason);
      if (canReplace) {
        if (!control) {
          await db.query(`INSERT INTO sx_chatbot_conversation_controls
            (id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,reason,revision,updated_by_kind,updated_by_identity_id)
            SELECT ?,tenant_id,channel_kind,channel_ref,conversation_id,'paused',expires_at,?,1,'identity',?
            FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND id=?`,
          [crypto.randomUUID(), reason, staffIdentity.id, ctx.tenant.id, claim.id]);
        } else {
          await db.query(`UPDATE sx_chatbot_conversation_controls c JOIN sx_chatbot_handoff_claims h
            ON h.tenant_id=c.tenant_id AND h.id=?
            SET c.mode='paused',c.pause_until=h.expires_at,c.reason=?,c.revision=c.revision+1,
              c.updated_by_kind='identity',c.updated_by_identity_id=?,c.updated_at=h.claimed_at
            WHERE c.tenant_id=? AND c.channel_kind=? AND c.channel_ref=? AND c.conversation_id=?`,
          [claim.id, reason, staffIdentity.id, ctx.tenant.id, channelKind, channelRef, claim.conversationId]);
        }
      }
    } else {
      await db.query(`UPDATE sx_chatbot_conversation_controls c
        JOIN sx_chatbot_handoff_claims h ON h.tenant_id=c.tenant_id AND h.id=?
        SET c.mode='inherit',c.pause_until=NULL,c.reason=NULL,c.revision=c.revision+1,
          c.updated_by_kind='system',c.updated_by_identity_id=NULL
        WHERE c.tenant_id=? AND c.channel_kind=? AND c.channel_ref=? AND c.conversation_id=?
          AND c.mode='paused' AND c.updated_by_kind='system' AND BINARY c.reason=BINARY h.reason`,
      [claim.id, ctx.tenant.id, channelKind, channelRef, claim.conversationId]);
    }
    if (claim.notificationEventKey) await db.query(`UPDATE sx_business_notification_deliveries d
      JOIN sx_business_notification_events e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
      SET d.status='suppressed',d.error_code='HANDOFF_ALREADY_CLAIMED'
      WHERE e.tenant_id=? AND e.event_key=? AND d.status IN ('queued','blocked')`, [ctx.tenant.id, claim.notificationEventKey]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','chatbot.handoff-claimed','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), ctx.tenant.id, staffIdentity.id, claim.conversationId, JSON.stringify({ claimId: claim.id, channelKind, claimedIdentityId: staffIdentity.id, relayEnabled: useRelay }), crypto.randomUUID()]);
    await db.commit();
    outcome = {
      handled: true, outcome: 'claimed', claimId: claim.id, claimCode: claim.claimCode, identityId: staffIdentity.id,
      identityName: staffIdentity.name, conversationId: claim.conversationId, customerChat, profileId: claim.profileId, relayEnabled: useRelay,
    };
    return outcome;
  } catch (error) {
    await db.rollback().catch(() => {});
    console.warn('[chatbot] staff handoff claim failed', error.code || 'HANDOFF_CLAIM_FAILED');
    return { handled: true, outcome: 'error', code: error.code || 'HANDOFF_CLAIM_FAILED' };
  } finally { db.release(); }
}

async function recordStaffReply(pool, { tenantId, uid, identityId, chatId, channelKind, channelRef }) {
  if (!tenantId || !uid || !identityId || !chatId || !['whatsapp_qr', 'whatsapp_meta'].includes(channelKind) || !channelRef) return { paused: false };
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const permitted = await require('./team-conversation-assignment').eligibleStaff(db, tenantId);
    if (!permitted.some(member => member.identityId === identityId)) { await db.commit(); return { paused: false }; }
    const ownerHash = crypto.createHash('sha256').update(uid).digest('hex');
    const [[claim]] = await db.query(`SELECT id,profile_id AS profileId,status,reason,notification_event_key AS notificationEventKey
      FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND owner_uid_hash=? AND channel_kind=? AND channel_ref=?
        AND conversation_id=? AND status IN ('open','claimed')
        AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)
      ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [tenantId, ownerHash, channelKind, channelRef, chatId]);
    if (!claim) { await db.commit(); return { paused: false }; }
    const [[profile]] = await db.query('SELECT config,category_key AS categoryKey FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, claim.profileId]);
    let config = profile?.config;
    try { if (typeof config === 'string') config = JSON.parse(config); } catch { config = null; }
    const minutes = holdMinutes(tenantId, { config, categoryKey: profile?.categoryKey });
    const reason = `staff-handoff:${claim.id}`;
    await db.query(`UPDATE sx_chatbot_handoff_claims SET status='claimed',claimed_identity_id=?,claimed_at=UTC_TIMESTAMP(3),
        expires_at=TIMESTAMPADD(MINUTE,?,UTC_TIMESTAMP(3)),revision=revision+1
      WHERE tenant_id=? AND id=? AND status IN ('open','claimed')`, [identityId, minutes, tenantId, claim.id]);
    const [[control]] = await db.query(`SELECT mode,reason,updated_by_kind AS updatedByKind,updated_by_identity_id AS updatedByIdentityId
      FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`,
    [tenantId, channelKind, channelRef, chatId]);
    let paused = false;
    const canReplaceControl = !control || control.mode !== 'paused'
      || (control.updatedByKind === 'system' && [claim.reason, reason].includes(control.reason))
      || (control.updatedByKind === 'identity' && control.updatedByIdentityId === identityId && control.reason === reason);
    if (canReplaceControl) {
      if (!control) {
        await db.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,reason,revision,updated_by_kind,updated_by_identity_id,updated_at)
          SELECT ?,tenant_id,channel_kind,channel_ref,conversation_id,'paused',expires_at,?,1,'identity',?,claimed_at
          FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND id=?`,
        [crypto.randomUUID(), reason, identityId, tenantId, claim.id]);
      } else {
        await db.query(`UPDATE sx_chatbot_conversation_controls c JOIN sx_chatbot_handoff_claims h
          ON h.tenant_id=c.tenant_id AND h.id=?
          SET c.mode='paused',c.pause_until=h.expires_at,c.reason=?,c.revision=c.revision+1,
            c.updated_by_kind='identity',c.updated_by_identity_id=?,c.updated_at=h.claimed_at
          WHERE c.tenant_id=? AND c.channel_kind=? AND c.channel_ref=? AND c.conversation_id=?`,
        [claim.id, reason, identityId, tenantId, channelKind, channelRef, chatId]);
      }
      paused = true;
    }
    if (claim.notificationEventKey) await db.query(`UPDATE sx_business_notification_deliveries d
      JOIN sx_business_notification_events e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
      SET d.status='suppressed',d.error_code='HANDOFF_STAFF_REPLIED'
      WHERE e.tenant_id=? AND e.event_key=? AND d.status IN ('queued','blocked')`, [tenantId, claim.notificationEventKey]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','chatbot.handoff-staff-replied','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), tenantId, identityId, chatId, JSON.stringify({ claimId: claim.id, channelKind, timeoutMinutes: minutes, pauseApplied: paused }), crypto.randomUUID()]);
    await db.commit();
    return { paused, timeoutMinutes: minutes };
  } catch (error) {
    await db.rollback().catch(() => {});
    console.warn('[chatbot] staff reply handoff update failed', error.code || 'HANDOFF_STAFF_REPLY_FAILED');
    return { paused: false, code: error.code || 'HANDOFF_STAFF_REPLY_FAILED' };
  } finally { db.release(); }
}

module.exports = { parseYes, phone, open, queue, confirmCallback, appendCallbackTask, findOpen, reserveCustomerAcknowledgement, releaseCustomerAcknowledgement, handleStaffClaim, recordStaffReply, expireDue, resetForCustomerGreeting, holdMinutes, staffRoles };
