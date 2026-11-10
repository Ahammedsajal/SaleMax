'use strict';

const { createHash, randomInt, randomUUID } = require('node:crypto');

const QATAR_OFFSET = 3 * 60 * 60 * 1000;
const DEFAULTS = Object.freeze({ enabled: true, dailyLimit: 20, minDelaySeconds: 120, maxDelaySeconds: 600 });
const tenantFromEnv = () => process.env.SALEMAX_CHATBOT_MOCKUP_TENANT_ID;
const safeCode = value => String(value || '').match(/^[A-Z0-9_]{1,64}$/)?.[0] || null;
const sqlDate = value => new Date(value).toISOString().slice(0, 23).replace('T', ' ');
const toEpoch = value => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const raw = String(value || '');
  if (!raw) return NaN;
  return Date.parse((raw.includes('T') ? raw : raw.replace(' ', 'T')) + (/(?:Z|[+-]\d\d:\d\d)$/i.test(raw) ? '' : 'Z'));
};
const qatarDay = value => new Date(value + QATAR_OFFSET).toISOString().slice(0, 10);
const isSendHour = value => {
  const local = new Date(value + QATAR_OFFSET);
  return local.getUTCHours() >= 9 && local.getUTCHours() < 18;
};
const randomDelay = settings => randomInt(Number(settings.min_delay_seconds), Number(settings.max_delay_seconds) + 1);
const normalizedNumber = value => String(value || '').replace(/\D/g, '');

async function ownerUid(pool, tenantId) {
  const uid = await require('./chatbot-owner-uid').legacyOwnerUidForTenant(pool, tenantId);
  if (!require('./chatbot-mockup').ownsInbox(uid, 'qr')) {
    throw Object.assign(Error('FOLLOWUP_OWNER_MISMATCH'), { code: 'FOLLOWUP_OWNER_MISMATCH' });
  }
  return uid;
}

async function readSettings(pool, tenantId) {
  const [[row]] = await pool.query(`SELECT enabled,daily_limit AS dailyLimit,
    min_delay_seconds AS minDelaySeconds,max_delay_seconds AS maxDelaySeconds,
    CAST(next_send_at AS CHAR) AS nextSendAt
    FROM sx_chatbot_followup_settings WHERE tenant_id=?`, [tenantId]);
  const [[counts]] = await pool.query(`SELECT
    SUM(status='queued') AS queued,
    SUM(status='sending') AS sending,
    SUM(status='uncertain') AS uncertain,
    SUM(status IN ('sent','uncertain') AND DATE(DATE_ADD(sent_at,INTERVAL 3 HOUR))=DATE(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 3 HOUR))) AS sentToday
    FROM sx_chatbot_followup_deliveries WHERE tenant_id=?`, [tenantId]);
  return {
    enabled: row ? Number(row.enabled) === 1 : DEFAULTS.enabled,
    dailyLimit: row ? Number(row.dailyLimit) : DEFAULTS.dailyLimit,
    minDelaySeconds: row ? Number(row.minDelaySeconds) : DEFAULTS.minDelaySeconds,
    maxDelaySeconds: row ? Number(row.maxDelaySeconds) : DEFAULTS.maxDelaySeconds,
    nextSendAt: row?.nextSendAt || null,
    queued: Number(counts?.queued || 0),
    sending: Number(counts?.sending || 0),
    uncertain: Number(counts?.uncertain || 0),
    sentToday: Number(counts?.sentToday || 0),
  };
}

async function setEnabled(pool, tenantId, enabled, identityId) {
  if (!identityId) throw Object.assign(Error('FOLLOWUP_ACTOR_REQUIRED'), { code: 'FOLLOWUP_ACTOR_REQUIRED' });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[current]] = await db.query('SELECT enabled FROM sx_chatbot_followup_settings WHERE tenant_id=? FOR UPDATE', [tenantId]);
    const previousEnabled = current ? Number(current.enabled) === 1 : DEFAULTS.enabled;
    if (!current) {
      await db.query(`INSERT INTO sx_chatbot_followup_settings
        (tenant_id,enabled,updated_by_identity_id) VALUES (?,?,?)`, [tenantId, enabled ? 1 : 0, identityId || null]);
    } else {
      await db.query(`UPDATE sx_chatbot_followup_settings SET next_send_at=IF(enabled<>?,NULL,next_send_at),
        enabled=?,updated_by_identity_id=? WHERE tenant_id=?`,
      [enabled ? 1 : 0, enabled ? 1 : 0, identityId || null, tenantId]);
    }
    if (previousEnabled !== enabled) {
      await db.query(`INSERT INTO sx_audit_events
        (id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,?,'identity','chatbot.followup-settings-updated','chatbot-followup-settings',?,?,?)`,
      [randomUUID(), tenantId, identityId, tenantId, JSON.stringify({ enabled, previousEnabled,
        dailyLimit: DEFAULTS.dailyLimit, delaySeconds: [DEFAULTS.minDelaySeconds, DEFAULTS.maxDelaySeconds] }), randomUUID()]);
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { db.release(); }
  return readSettings(pool, tenantId);
}

async function enqueueDue(db, tenantId) {
  await db.query(`INSERT INTO sx_chatbot_followup_deliveries
    (tenant_id,lead_id,step,due_at,status)
    SELECT p.tenant_id,p.lead_id,'day2',p.day_two_at,'queued'
    FROM sx_chatbot_followup_previews p
    WHERE p.tenant_id=? AND p.source IN ('reviewed','scheduled') AND p.status='ready'
      AND p.day_two_at IS NOT NULL AND p.day_two_at<=UTC_TIMESTAMP(3)
    ON DUPLICATE KEY UPDATE due_at=IF(sx_chatbot_followup_deliveries.status='queued',VALUES(due_at),sx_chatbot_followup_deliveries.due_at),
      updated_at=IF(sx_chatbot_followup_deliveries.status='queued',UTC_TIMESTAMP(3),sx_chatbot_followup_deliveries.updated_at)`, [tenantId]);

  await db.query(`INSERT INTO sx_chatbot_followup_deliveries
    (tenant_id,lead_id,step,due_at,status)
    SELECT p.tenant_id,p.lead_id,'day7',GREATEST(p.day_seven_at,DATE_ADD(d2.sent_at,INTERVAL 5 DAY)),'queued'
    FROM sx_chatbot_followup_previews p
    JOIN sx_chatbot_followup_deliveries d2 ON d2.tenant_id=p.tenant_id AND d2.lead_id=p.lead_id
      AND d2.step='day2' AND d2.status='sent'
    WHERE p.tenant_id=? AND p.source IN ('reviewed','scheduled') AND p.status='ready'
      AND p.day_seven_at IS NOT NULL AND p.last_customer_at<=d2.sent_at
    ON DUPLICATE KEY UPDATE due_at=IF(sx_chatbot_followup_deliveries.status='queued',VALUES(due_at),sx_chatbot_followup_deliveries.due_at),
      updated_at=IF(sx_chatbot_followup_deliveries.status='queued',UTC_TIMESTAMP(3),sx_chatbot_followup_deliveries.updated_at)`, [tenantId]);

  await db.query(`UPDATE sx_chatbot_followup_deliveries d
    JOIN sx_chatbot_followup_previews p ON p.tenant_id=d.tenant_id AND p.lead_id=d.lead_id
    SET d.status='skipped',d.last_error_code=p.reason,d.lease_token=NULL,d.lease_until=NULL
    WHERE d.tenant_id=? AND d.step='day2' AND d.status='queued' AND p.status IN ('review','skipped')`, [tenantId]);
  await db.query(`UPDATE sx_chatbot_followup_deliveries d
    JOIN sx_chatbot_followup_previews p ON p.tenant_id=d.tenant_id AND p.lead_id=d.lead_id
    SET d.status='skipped',d.last_error_code=p.reason,d.lease_token=NULL,d.lease_until=NULL
    WHERE d.tenant_id=? AND d.step='day7' AND d.status='queued' AND p.status IN ('review','skipped')`, [tenantId]);
  await db.query(`UPDATE sx_chatbot_followup_deliveries d7
    JOIN sx_chatbot_followup_deliveries d2 ON d2.tenant_id=d7.tenant_id AND d2.lead_id=d7.lead_id
      AND d2.step='day2' AND d2.status='sent'
    JOIN sx_chatbot_followup_previews p ON p.tenant_id=d7.tenant_id AND p.lead_id=d7.lead_id
    SET d7.status='skipped',d7.last_error_code='CUSTOMER_REPLIED',d7.lease_token=NULL,d7.lease_until=NULL
    WHERE d7.tenant_id=? AND d7.step='day7' AND d7.status='queued' AND p.last_customer_at>d2.sent_at`, [tenantId]);
}

async function nextQueued(db, tenantId) {
  const [[row]] = await db.query(`SELECT d.id,d.lead_id AS leadId,d.step,d.due_at AS dueAt,
      p.first_draft AS firstDraft,p.second_draft AS secondDraft,p.last_customer_at AS lastCustomerAt,
      CAST(d2.sent_at AS CHAR) AS dayTwoSentAt
    FROM sx_chatbot_followup_deliveries d
    JOIN sx_chatbot_followup_previews p ON p.tenant_id=d.tenant_id AND p.lead_id=d.lead_id
    LEFT JOIN sx_chatbot_followup_deliveries d2 ON d2.tenant_id=d.tenant_id AND d2.lead_id=d.lead_id
      AND d2.step='day2' AND d2.status='sent'
    WHERE d.tenant_id=? AND d.status='queued' AND d.due_at<=UTC_TIMESTAMP(3)
      AND p.status='ready' AND p.source IN ('reviewed','scheduled')
    ORDER BY FIELD(p.source,'reviewed','scheduled'),FIELD(d.step,'day2','day7'),d.due_at,d.id LIMIT 1`, [tenantId]);
  return row || null;
}

async function resolveOriginalQr(pool, uid, tenantId, leadId) {
  const uidHash = createHash('sha256').update(uid).digest('hex');
  const [[chat]] = await pool.query(`SELECT c.chat_id AS chatId,b.sender_mobile AS senderMobile,
      b.sender_name AS senderName,b.origin,b.origin_instance_unique_id AS instanceId,
      i.number AS instanceNumber,i.status AS instanceStatus
    FROM pipeline_conversations c
    JOIN beta_chats b ON b.uid=? COLLATE utf8mb4_unicode_ci
      AND b.chat_id=c.chat_id COLLATE utf8mb4_unicode_ci AND BINARY b.origin=BINARY c.origin
    JOIN instance i ON i.uid=b.uid AND i.uniqueId=b.origin_instance_unique_id
    WHERE c.uid_hash=? AND BINARY c.lead_id=BINARY ? AND c.origin='qr' AND b.origin='qr'
      AND b.origin_instance_unique_id IS NOT NULL AND b.origin_instance_unique_id<>''
      AND LEFT(c.chat_id,8)<>'qrgroup_'
    ORDER BY c.first_inbound_at,c.id LIMIT 1`, [uid, uidHash, leadId]);
  if (!chat || require('./qr-inbox-groups').isGroup({ chat_id: chat.chatId })) return null;
  const parts = String(chat.chatId).split('_');
  if (parts.length < 3 || parts.slice(2).join('_') !== uid
    || normalizedNumber(parts[0]) !== normalizedNumber(chat.instanceNumber)
    || normalizedNumber(parts[1]) !== normalizedNumber(chat.senderMobile)) return null;
  const { getSession } = require('../../helper/addon/qr');
  const session = getSession(chat.instanceId);
  // Inbox sends through this same session object without imposing a separate
  // WebSocket-ready/user-id gate. Let the QR transport report whether it can
  // send; a stricter preflight can reject an Inbox-usable session.
  if (!session) return { ...chat, sessionUnavailable: true };
  return { ...chat, session };
}

async function revalidate(pool, tenantId, uid, item) {
  const preview = require('./chatbot-followup-preview');
  return preview.evaluateLead(pool, tenantId, uid, item.leadId, Date.now());
}

async function markSuppressed(db, item, reason) {
  await db.query(`UPDATE sx_chatbot_followup_deliveries
    SET status='skipped',last_error_code=?,lease_token=NULL,lease_until=NULL
    WHERE id=? AND status IN ('queued','sending')`, [safeCode(reason) || 'FOLLOWUP_SUPPRESSED', item.id]);
}

async function persistSent(pool, uid, uidHash, tenantId, item, target, messageId, text) {
  const content = { type: 'text', text: { preview_url: false, body: text } };
  const messageData = {
    type: 'text', metaChatId: messageId, msgContext: content, reaction: '', timestamp: Math.trunc(Date.now() / 1000),
    senderName: 'Pro Catalyst', senderMobile: target.senderMobile || '', star: 0,
    route: 'OUTGOING', context: null, origin: 'qr', sentBy: 'automation', status: 'sent',
  };
  await pool.query(`UPDATE sx_chatbot_followup_deliveries
    SET status='sent',provider_message_id=?,sent_at=UTC_TIMESTAMP(3),last_error_code=NULL,lease_token=NULL,lease_until=NULL
    WHERE id=? AND status='sending'`, [messageId, item.id]);
  try {
    await require('./chatbot-conversation-store').persistConversationMessage({ uid, chatId: target.chatId,
      data: { ...messageData, msgContext: JSON.stringify(content), context: null }, pool });
    await pool.query('UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?', [JSON.stringify(messageData), uid, target.chatId]);
  } catch (error) {
    console.warn('[chatbot follow-up] conversation persistence failed', safeCode(error.code) || 'FOLLOWUP_HISTORY_ERROR');
  }
  await pool.query(`INSERT INTO pipeline_activity
    (uid_hash,lead_id,actor_type,activity_type,summary,details,created_at)
    VALUES (?,?,'system','follow_up_completed',?,?,UTC_TIMESTAMP(3))`,
  [uidHash, item.leadId, `Automated WhatsApp ${item.step === 'day2' ? 'Day 2' : 'Day 7'} follow-up sent`,
    JSON.stringify({ channel: 'qr', instanceId: target.instanceId, step: item.step, deliveryId: String(item.id), providerMessageId: messageId })]).catch(error => {
    console.warn('[chatbot follow-up] activity log failed', safeCode(error.code) || 'FOLLOWUP_ACTIVITY_ERROR');
  });
}

async function processOne(pool, db, tenantId) {
  await db.query('INSERT IGNORE INTO sx_chatbot_followup_settings (tenant_id) VALUES (?)', [tenantId]);
  await db.query(`UPDATE sx_chatbot_followup_deliveries SET status='uncertain',last_error_code='SEND_RESULT_UNCERTAIN',
    sent_at=COALESCE(sent_at,UTC_TIMESTAMP(3)),lease_token=NULL,lease_until=NULL
    WHERE tenant_id=? AND status='sending' AND lease_until<=UTC_TIMESTAMP(3)`, [tenantId]);
  const settings = await readSettings(pool, tenantId);
  if (!settings.enabled) return false;
  await enqueueDue(db, tenantId);
  const item = await nextQueued(db, tenantId);
  if (!item) return false;
  if (!isSendHour(Date.now())) return false;
  if (settings.sentToday >= Math.min(settings.dailyLimit, DEFAULTS.dailyLimit)) return false;

  const uid = await ownerUid(pool, tenantId);
  const target = await resolveOriginalQr(pool, uid, tenantId, item.leadId);
  if (!target) {
    await db.query(`UPDATE sx_chatbot_followup_deliveries SET last_error_code='ORIGINAL_QR_MAPPING_UNAVAILABLE'
      WHERE id=? AND status='queued'`, [item.id]);
    return false;
  }
  if (target.sessionUnavailable) {
    await db.query(`UPDATE sx_chatbot_followup_deliveries SET last_error_code='ORIGINAL_QR_SESSION_UNAVAILABLE'
      WHERE id=? AND status='queued'`, [item.id]);
    return false;
  }

  const pause = await require('./chatbot-conversation-control').shouldPause(uid, target.chatId, 'whatsapp_qr', target.instanceId).catch(() => true);
  if (pause) {
    await markSuppressed(db, item, 'CONVERSATION_PAUSED');
    return false;
  }

  const currentDue = item.step === 'day2' ? toEpoch(item.dueAt) : Math.max(toEpoch(item.dueAt), toEpoch(item.dayTwoSentAt) + 5 * 86400000);
  const checked = await revalidate(pool, tenantId, uid, item);
  if (item.step === 'day7' && Number.isFinite(toEpoch(checked.lastAt))
    && toEpoch(checked.lastAt) > toEpoch(item.dayTwoSentAt)) {
    await markSuppressed(db, item, 'CUSTOMER_REPLIED');
    return false;
  }
  if (checked.status === 'skipped' || checked.status === 'review') {
    await markSuppressed(db, item, checked.reason);
    return false;
  }
  const recomputedDue = item.step === 'day2' ? checked.two : Math.max(checked.seven, toEpoch(item.dayTwoSentAt) + 5 * 86400000);
  if (checked.status !== 'ready' || !Number.isFinite(recomputedDue) || recomputedDue > Date.now() || currentDue > Date.now()) {
    await db.query(`UPDATE sx_chatbot_followup_deliveries SET due_at=?,status='queued',last_error_code=?,
      lease_token=NULL,lease_until=NULL WHERE id=? AND status='queued'`,
    [sqlDate(Number.isFinite(recomputedDue) ? Math.max(recomputedDue, Date.now() + 1000) : Date.now() + 60000),
      safeCode(checked.reason) || 'FOLLOWUP_NOT_DUE', item.id]);
    return false;
  }

  const text = String(item.step === 'day2' ? item.firstDraft : item.secondDraft || '').trim();
  if (text.length < 25 || text.length > 600 || /[\r\n]/u.test(text)) {
    await db.query(`UPDATE sx_chatbot_followup_deliveries SET last_error_code='FOLLOWUP_DRAFT_UNAVAILABLE'
      WHERE id=? AND status='queued'`, [item.id]);
    return false;
  }

  const latestSettings = await readSettings(pool, tenantId);
  if (!latestSettings.enabled || latestSettings.sentToday >= Math.min(latestSettings.dailyLimit, DEFAULTS.dailyLimit)) return false;
  const latestPause = await require('./chatbot-conversation-control').shouldPause(uid, target.chatId, 'whatsapp_qr', target.instanceId).catch(() => true);
  if (latestPause) {
    await markSuppressed(db, item, 'CONVERSATION_PAUSED');
    return false;
  }

  const leaseToken = randomUUID();
  await db.beginTransaction();
  try {
    const [[locked]] = await db.query(`SELECT status FROM sx_chatbot_followup_deliveries
      WHERE id=? FOR UPDATE`, [item.id]);
    if (locked?.status !== 'queued') { await db.rollback(); return false; }
    await db.query(`UPDATE sx_chatbot_followup_deliveries SET status='sending',attempts=attempts+1,
      lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),last_error_code=NULL WHERE id=?`, [leaseToken, item.id]);
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  }

  let messageId = null;
  try {
    messageId = await require('../../automation/functions').sendWaMessage({
      origin: 'qr', sessionId: target.instanceId, uid, chatId: target.chatId,
      message: { senderMobile: target.senderMobile, senderName: target.senderName || 'Customer' },
      content: { type: 'text', text: { preview_url: false, body: text } },
    });
  } catch (error) {
    console.warn('[chatbot follow-up] QR transport failed', safeCode(error.code) || 'QR_SEND_RESULT_UNCERTAIN');
  }

  if (messageId) {
    await persistSent(pool, uid, createHash('sha256').update(uid).digest('hex'), tenantId, item, target, String(messageId), text);
    const delay = randomDelay({ min_delay_seconds: latestSettings.minDelaySeconds, max_delay_seconds: latestSettings.maxDelaySeconds });
    await db.query('UPDATE sx_chatbot_followup_settings SET next_send_at=? WHERE tenant_id=?', [sqlDate(Date.now() + delay * 1000), tenantId]);
    return true;
  }

  await db.query(`UPDATE sx_chatbot_followup_deliveries SET status='uncertain',last_error_code='SEND_RESULT_UNCERTAIN',
    sent_at=UTC_TIMESTAMP(3),lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`, [item.id, leaseToken]);
  const delay = randomDelay({ min_delay_seconds: latestSettings.minDelaySeconds, max_delay_seconds: latestSettings.maxDelaySeconds });
  await db.query('UPDATE sx_chatbot_followup_settings SET next_send_at=? WHERE tenant_id=?', [sqlDate(Date.now() + delay * 1000), tenantId]);
  return false;
}

async function tick(pool, tenantId = tenantFromEnv()) {
  if (!require('./chatbot-followup-preview').enabled(tenantId)) return false;
  const db = await pool.getConnection();
  const lockName = 'chatbot-followup-delivery:' + tenantId;
  try {
    const [[lock]] = await db.query('SELECT GET_LOCK(?,0) AS held', [lockName]);
    if (Number(lock.held) !== 1) return false;
    await db.query('INSERT IGNORE INTO sx_chatbot_followup_settings (tenant_id) VALUES (?)', [tenantId]);
    await db.query(`UPDATE sx_chatbot_followup_deliveries SET status='uncertain',last_error_code='SEND_RESULT_UNCERTAIN',
      sent_at=COALESCE(sent_at,UTC_TIMESTAMP(3)),lease_token=NULL,lease_until=NULL
      WHERE tenant_id=? AND status='sending' AND lease_until<=UTC_TIMESTAMP(3)`, [tenantId]);
    const settings = await readSettings(pool, tenantId);
    if (!settings.enabled) return false;
    await enqueueDue(db, tenantId);
    const item = await nextQueued(db, tenantId);
    if (!item || !isSendHour(Date.now()) || settings.sentToday >= Math.min(settings.dailyLimit, DEFAULTS.dailyLimit)) return false;
    const uid = await ownerUid(pool, tenantId);
    const target = await resolveOriginalQr(pool, uid, tenantId, item.leadId);
    if (!target) {
      await db.query(`UPDATE sx_chatbot_followup_deliveries SET last_error_code='ORIGINAL_QR_MAPPING_UNAVAILABLE'
        WHERE id=? AND status='queued'`, [item.id]);
      return false;
    }
    if (target.sessionUnavailable) {
      await db.query(`UPDATE sx_chatbot_followup_deliveries SET last_error_code='ORIGINAL_QR_SESSION_UNAVAILABLE'
        WHERE id=? AND status='queued'`, [item.id]);
      return false;
    }
    const refreshed = await readSettings(pool, tenantId);
    if (!refreshed.enabled || refreshed.sentToday >= Math.min(refreshed.dailyLimit, DEFAULTS.dailyLimit)) return false;
    const [[recent]] = await db.query(`SELECT CAST(MAX(sent_at) AS CHAR) AS lastSentAt FROM sx_chatbot_followup_deliveries
      WHERE tenant_id=? AND status IN ('sent','uncertain')`, [tenantId]);
    const lastSentAt = toEpoch(recent?.lastSentAt);
    const minimumSpacingAt = Number.isFinite(lastSentAt) ? lastSentAt + DEFAULTS.minDelaySeconds * 1000 : NaN;
    const nextAt = toEpoch(refreshed.nextSendAt);
    if (Number.isFinite(minimumSpacingAt) && (!Number.isFinite(nextAt) || nextAt < minimumSpacingAt)) {
      await db.query('UPDATE sx_chatbot_followup_settings SET next_send_at=? WHERE tenant_id=?', [sqlDate(minimumSpacingAt), tenantId]);
      if (minimumSpacingAt > Date.now()) return false;
    }
    if (Number.isFinite(nextAt) && nextAt > Date.now()) return false;
    if (!refreshed.nextSendAt) {
      const delay = randomDelay({ min_delay_seconds: refreshed.minDelaySeconds, max_delay_seconds: refreshed.maxDelaySeconds });
      await db.query('UPDATE sx_chatbot_followup_settings SET next_send_at=? WHERE tenant_id=?', [sqlDate(Date.now() + delay * 1000), tenantId]);
      return false;
    }
    return await processOne(pool, db, tenantId);
  } finally {
    await db.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    db.release();
  }
}

function start(pool) {
  const tenantId = tenantFromEnv();
  if (!require('./chatbot-followup-preview').enabled(tenantId)) return;
  const run = async () => {
    try { await tick(pool, tenantId); }
    catch (error) { console.warn('[chatbot follow-up] delivery worker unavailable', safeCode(error.code) || 'FOLLOWUP_WORKER_ERROR'); }
    finally { setTimeout(run, 10000).unref(); }
  };
  setTimeout(run, 5000).unref();
}

module.exports = { DEFAULTS, readSettings, setEnabled, enqueueDue, resolveOriginalQr, tick, start, qatarDay, isSendHour };
