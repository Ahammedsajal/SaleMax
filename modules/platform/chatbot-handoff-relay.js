'use strict';

const crypto = require('node:crypto');

const STAFF_ROLES = ['owner', 'manager', 'team_leader', 'agent'];
const MAX_ATTEMPTS = 5;
const RETRY_SECONDS = [15, 45, 120, 300];
const workerId = `handoff-relay-${process.pid}`;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function textOf(message) {
  const body = message?.msgContext?.text?.body;
  return typeof body === 'string' ? body : '';
}
function parseCommand(value) {
  const text = String(value || '').normalize('NFKC').trim();
  const close = text.match(/^CLOSE\s+([A-Z0-9]{6})[.!؟]?$/iu);
  if (close) return { action: 'close', code: close[1].toUpperCase() };
  const reply = text.match(/^([A-Z0-9]{6}):\s*([\s\S]{1,4000})$/iu);
  if (reply && reply[2].trim()) return { action: 'reply', code: reply[1].toUpperCase(), body: reply[2].trim() };
  return null;
}

function relayKey() {
  const encoded = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) fail('HANDOFF_RELAY_KEY_UNAVAILABLE');
  const master = Buffer.from(encoded, 'base64');
  if (master.length !== 32 || master.toString('base64') !== encoded) fail('HANDOFF_RELAY_KEY_UNAVAILABLE');
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'salemax/chatbot/handoff-relay-payload/v1', 32));
}

function encryptPayload(payload, { tenantId, claimId, deliveryId }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', relayKey(), iv);
  cipher.setAAD(Buffer.from(`${tenantId}:${claimId}:${deliveryId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decryptPayload(row) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', relayKey(), Buffer.from(row.payload_iv));
  decipher.setAAD(Buffer.from(`${row.tenant_id}:${row.claim_id}:${row.id}`));
  decipher.setAuthTag(Buffer.from(row.payload_auth_tag));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.payload_ciphertext)), decipher.final()]).toString('utf8'));
}

function sourceMessageId(message) {
  const value = String(message?.metaChatId || '').trim();
  if (!value) return null;
  return /^[\x21-\x7e]{1,191}$/.test(value) ? value : sha(value);
}

async function currentStaff(db, tenantId, senderMobile) {
  const qr = require('./business-whatsapp');
  const assignment = require('./team-conversation-assignment');
  const [[tenant]] = await db.query('SELECT timezone FROM sx_tenants WHERE id=? LIMIT 1', [tenantId]);
  const countryCode = tenant?.timezone === 'Asia/Qatar' ? '974' : undefined;
  const from = qr.phone(senderMobile, { countryCode });
  if (!from) return null;
  const phones = await qr.staff(db, tenantId, { roles: STAFF_ROLES });
  const eligible = await assignment.eligibleStaff(db, tenantId);
  const permitted = new Map(eligible.map(member => [member.identityId, member]));
  const matches = phones.filter(member => member.phone && qr.phone(member.phone, { countryCode }) === from);
  if (matches.length > 1) return { ambiguous: true, phone: from, eligible: false };
  if (matches.length !== 1) return null;
  return { ...(permitted.get(matches[0].id) || { identityId: matches[0].id, role: matches[0].role, name: 'Staff member' }),
    phone: matches[0].phone, eligible: permitted.has(matches[0].id) };
}

async function audit(db, { tenantId, actorIdentityId = null, actorKind = 'system', action, resourceId, changes }) {
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,?,?,'chatbot-handoff-relay',?,?,?)`,
  [crypto.randomUUID(), tenantId, actorIdentityId, actorKind, action, resourceId,
    JSON.stringify(changes || {}), crypto.randomUUID()]);
}

async function enqueue(pool, { tenantId, claimId, direction, sourceId, actorIdentityId = null, payload }) {
  if (!sourceId) return { status: 'failed', errorCode: 'SOURCE_MESSAGE_ID_MISSING' };
  const id = crypto.randomUUID();
  const sealed = encryptPayload(payload, { tenantId, claimId, deliveryId: id });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [inserted] = await db.query(`INSERT IGNORE INTO sx_chatbot_handoff_relay_deliveries
      (id,tenant_id,claim_id,direction,source_message_id,actor_identity_id,status,available_at,payload_ciphertext,payload_iv,payload_auth_tag)
      VALUES (?,?,?,?,?,?,'pending',UTC_TIMESTAMP(3),?,?,?)`,
    [id, tenantId, claimId, direction, sourceId, actorIdentityId, sealed.ciphertext, sealed.iv, sealed.authTag]);
    const [[row]] = await db.query(`SELECT id,status,attempts FROM sx_chatbot_handoff_relay_deliveries
      WHERE tenant_id=? AND claim_id=? AND direction=? AND source_message_id=? FOR UPDATE`, [tenantId, claimId, direction, sourceId]);
    if (inserted.affectedRows === 1) {
      await audit(db, { tenantId, actorIdentityId, actorKind: actorIdentityId ? 'identity' : 'system', action: 'chatbot.handoff-relay-queued', resourceId: claimId,
        changes: { deliveryId: id, direction, status: 'pending' } });
    }
    await db.commit();
    return { id: row.id, status: row.status, attempts: Number(row.attempts), created: inserted.affectedRows === 1 };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function claimNext(pool) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // A timed-out send may already have reached WhatsApp. Mark it unknown and
    // require review instead of retrying and risking a duplicate customer text.
    const [stale] = await db.query(`UPDATE sx_chatbot_handoff_relay_deliveries
      SET status='unknown',lease_owner=NULL,lease_until=NULL,last_error_code='DELIVERY_LEASE_EXPIRED',
        payload_ciphertext=NULL,payload_iv=NULL,payload_auth_tag=NULL
      WHERE status='processing' AND lease_until<=UTC_TIMESTAMP(3) LIMIT 20`);
    const [[row]] = await db.query(`SELECT d.id,d.tenant_id,d.claim_id,d.direction,d.source_message_id,d.actor_identity_id,
        d.payload_ciphertext,d.payload_iv,d.payload_auth_tag,d.attempts AS priorAttempts,h.channel_ref,h.conversation_id,h.owner_uid_hash,
        h.claimed_identity_id,h.status AS claimStatus,h.expires_at,h.relay_enabled,h.profile_id
      FROM sx_chatbot_handoff_relay_deliveries d JOIN sx_chatbot_handoff_claims h ON h.tenant_id=d.tenant_id AND h.id=d.claim_id
      WHERE d.status='pending' AND d.available_at<=UTC_TIMESTAMP(3)
        AND h.status='claimed' AND h.relay_enabled=1 AND h.expires_at>UTC_TIMESTAMP(3)
      ORDER BY d.available_at,d.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!row) { await db.commit(); return null; }
    const [claimed] = await db.query(`UPDATE sx_chatbot_handoff_relay_deliveries SET status='processing',attempts=attempts+1,
      lease_owner=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND),last_error_code=NULL
      WHERE id=? AND status='pending'`, [workerId, row.id]);
    if (claimed.affectedRows !== 1) { await db.commit(); return null; }
    await db.commit();
    return { ...row, attempts: 1 + Number(row.priorAttempts || 0), staleCount: Number(stale.affectedRows || 0) };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function currentRelayAuthorization(pool, row, payload) {
  const db = await pool.getConnection();
  try {
    const [[claim]] = await db.query(`SELECT h.status,h.relay_enabled,h.claimed_identity_id AS identityId,h.expires_at AS expiresAt,
        h.owner_uid_hash AS ownerHash,h.conversation_id AS chatId,h.channel_ref AS channelRef,h.profile_id AS profileId,
        p.config,p.status AS profileStatus,u.uid,c.sender_mobile AS customerPhone,c.sender_name AS customerName,c.origin
      FROM sx_chatbot_handoff_claims h JOIN sx_chatbot_profiles p ON p.tenant_id=h.tenant_id AND p.id=h.profile_id
      JOIN sx_legacy_ownership o ON o.tenant_id=h.tenant_id AND o.source_table='user' AND o.legacy_uid_hash=h.owner_uid_hash
      JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
        AND o.legacy_uid_hash=CONVERT(SHA2(u.uid,256) USING ascii) COLLATE ascii_bin
      JOIN beta_chats c ON c.uid=u.uid AND BINARY c.chat_id=BINARY h.conversation_id
      WHERE h.tenant_id=? AND h.id=? AND h.expires_at>UTC_TIMESTAMP(3) LIMIT 1`, [row.tenant_id, row.claim_id]);
    if (!claim || claim.status !== 'claimed' || Number(claim.relay_enabled) !== 1 || claim.profileStatus !== 'live' || claim.origin !== 'qr'
      || claim.channelRef !== payload.channelRef || claim.chatId !== payload.customerChatId
      || claim.identityId !== payload.staffIdentityId) return null;
    const enabled = typeof claim.config === 'string' ? JSON.parse(claim.config || '{}') : claim.config;
    if (enabled?.staffWhatsAppRelayEnabled !== true) return null;
    const eligible = await require('./team-conversation-assignment').eligibleStaff(db, row.tenant_id);
    const identity = eligible.find(member => member.identityId === claim.identityId);
    if (!identity) return null;
    const qr = require('./business-whatsapp');
    const staffPhones = await qr.staff(db, row.tenant_id, { roles: STAFF_ROLES });
    const phone = staffPhones.find(member => member.id === identity.identityId)?.phone;
    if (!phone || qr.phone(phone) !== qr.phone(payload.staffPhone)) return null;
    if (row.direction !== 'customer_to_staff' && row.actor_identity_id !== claim.identityId) return null;
    if (row.direction === 'customer_to_staff' && (row.actor_identity_id || null) !== null) return null;
    if (!claim.uid) return null;
    return { uid: claim.uid, claim, identity };
  } finally { db.release(); }
}

async function finishDelivery(pool, row, outcome, payload = null, uid = null) {
  const db = await pool.getConnection();
  let accepted = false;
  try {
    await db.beginTransaction();
    const [[current]] = await db.query(`SELECT status,lease_owner,attempts FROM sx_chatbot_handoff_relay_deliveries WHERE tenant_id=? AND id=? FOR UPDATE`,
      [row.tenant_id, row.id]);
    if (!current || current.status !== 'processing' || current.lease_owner !== workerId) { await db.commit(); return { status: 'stale' }; }
    const attempts = Number(current.attempts);
    let status = outcome.status;
    let errorCode = outcome.errorCode || null;
    let availableInSeconds = 0;
    if (status === 'retry') {
      if (attempts >= MAX_ATTEMPTS) status = 'failed';
      else { status = 'pending'; availableInSeconds = RETRY_SECONDS[Math.min(attempts - 1, RETRY_SECONDS.length - 1)]; }
    }
    const terminal = ['sent', 'failed', 'unknown', 'suppressed'].includes(status);
    const [updated] = await db.query(`UPDATE sx_chatbot_handoff_relay_deliveries SET status=?,available_at=IF(?='pending',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),available_at),
      lease_owner=NULL,lease_until=NULL,provider_message_id=?,last_error_code=?,accepted_at=IF(?='sent',UTC_TIMESTAMP(3),NULL),
      payload_ciphertext=IF(?=1,NULL,payload_ciphertext),payload_iv=IF(?=1,NULL,payload_iv),payload_auth_tag=IF(?=1,NULL,payload_auth_tag)
      WHERE tenant_id=? AND id=? AND status='processing' AND lease_owner=?`,
    [status, status, availableInSeconds, outcome.providerMessageId || null, errorCode, status,
      terminal ? 1 : 0, terminal ? 1 : 0, terminal ? 1 : 0, row.tenant_id, row.id, workerId]);
    if (updated.affectedRows !== 1) { await db.rollback(); return { status: 'stale' }; }
    await audit(db, { tenantId: row.tenant_id, actorIdentityId: row.actor_identity_id || null,
      actorKind: row.actor_identity_id ? 'identity' : 'system', action: 'chatbot.handoff-relay-delivered', resourceId: row.claim_id,
      changes: { deliveryId: row.id, direction: row.direction, status, attempts, providerMessageId: outcome.providerMessageId || null, errorCode } });
    await db.commit();
    accepted = status === 'sent';
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
  if (accepted && payload && uid) await persistOutbound({ pool, row, payload, uid, providerMessageId: outcome.providerMessageId });
  return { id: row.id, status: accepted ? 'sent' : outcome.status, errorCode: outcome.errorCode || null };
}

async function persistOutbound({ pool, row, payload, uid, providerMessageId }) {
  if (!providerMessageId || !payload?.targetChatId) return;
  const body = payload.text;
  const content = { type: 'text', text: { preview_url: false, body } };
  const actorName = row.direction === 'staff_to_customer' ? payload.staffName : '7Network';
  const record = { type: 'text', metaChatId: providerMessageId, msgContext: JSON.stringify(content), reaction: '',
    timestamp: Math.trunc(Date.now() / 1000), senderName: actorName, senderMobile: payload.targetPhone, star: 0,
    route: 'OUTGOING', context: row.direction === 'staff_to_customer' ? { kind: 'handoff-relay', claimId: row.claim_id, actorIdentityId: row.actor_identity_id } : null,
    origin: 'qr', sentBy: row.direction === 'staff_to_customer' ? 'human' : 'bot' };
  try {
    await require('./chatbot-conversation-store').persistConversationMessage({ uid, chatId: payload.targetChatId, data: record, pool });
    await pool.query('UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?',
      [JSON.stringify({ ...record, msgContext: content }), uid, payload.targetChatId]);
  } catch (error) {
    console.warn('[chatbot handoff relay] sent message history update unavailable', error.code || 'RELAY_HISTORY_UPDATE_FAILED');
  }
}

async function deliverOne(pool, row) {
  let payload;
  try { payload = decryptPayload(row); }
  catch (error) { return finishDelivery(pool, row, { status: 'failed', errorCode: error.code || 'RELAY_PAYLOAD_UNREADABLE' }); }
  const authorization = await currentRelayAuthorization(pool, row, payload).catch(() => null);
  if (!authorization) return finishDelivery(pool, row, { status: 'suppressed', errorCode: 'RELAY_ASSIGNMENT_NO_LONGER_ACTIVE' });
  const content = { type: 'text', text: { preview_url: false, body: payload.text } };
  const stableId = '3EB0' + sha(row.id).slice(0, 18).toUpperCase();
  const outcome = await require('../../automation/functions').sendWaMessage({
    origin: 'qr', sessionId: payload.channelRef,
    message: { senderMobile: payload.targetPhone, senderName: payload.staffName || '7Network' },
    uid: authorization.uid, chatId: row.direction === 'staff_to_customer' ? (payload.targetChatId || null) : null,
    content, bypassBotPause: row.direction === 'staff_to_customer',
    allowPauseReason: row.direction === 'staff_to_customer' ? `staff-handoff-relay:${row.claim_id}` : null,
    senderKind: 'handoff-relay',
    deliveryResult: true, providerMessageId: stableId,
  });
  if (outcome?.status === 'sent') return finishDelivery(pool, row, outcome, payload, authorization.uid);
  return finishDelivery(pool, row, outcome || { status: 'unknown', errorCode: 'QR_SEND_OUTCOME_UNKNOWN' });
}

async function tick(pool, { limit = 10 } = {}) {
  const results = [];
  for (let i = 0; i < Math.max(1, Math.min(25, limit)); i++) {
    const row = await claimNext(pool);
    if (!row) break;
    results.push(await deliverOne(pool, row));
  }
  return results;
}

function start(pool, { setTimeoutImpl = setTimeout } = {}) {
  if (!pool || process.env.LOCAL_ONLY_MODE === 'true') return () => {};
  let busy = false;
  let stopped = false;
  let timer;
  const next = async () => {
    if (stopped) return;
    if (busy) { timer = setTimeoutImpl(next, 5000); timer.unref?.(); return; }
    busy = true;
    try { await tick(pool); }
    catch (error) { console.warn('[chatbot handoff relay] worker tick unavailable', error.code || 'RELAY_WORKER_ERROR'); }
    finally { busy = false; }
    if (!stopped) { timer = setTimeoutImpl(next, 5000); timer.unref?.(); }
  };
  timer = setTimeoutImpl(next, 1000); timer.unref?.();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

async function lookupCustomerClaim(db, { ctx, profile, uid, channelRef, chatId }) {
  const ownerHash = sha(uid);
  const [[row]] = await db.query(`SELECT h.id,h.claim_code AS claimCode,h.claimed_identity_id AS staffIdentityId,
      h.owner_uid_hash AS ownerHash,h.conversation_id AS customerChatId,h.channel_ref AS channelRef,
      h.profile_id AS profileId,h.expires_at AS expiresAt,c.sender_mobile AS customerPhone,c.sender_name AS customerName,c.origin,
      i.display_name AS staffName
    FROM sx_chatbot_handoff_claims h JOIN beta_chats c ON c.uid=? AND BINARY c.chat_id=BINARY h.conversation_id
    JOIN sx_identities i ON i.id=h.claimed_identity_id
    WHERE h.tenant_id=? AND h.profile_id=? AND h.owner_uid_hash=? AND h.channel_kind='whatsapp_qr'
      AND h.channel_ref=? AND h.conversation_id=? AND h.status='claimed' AND h.relay_enabled=1
      AND h.expires_at>UTC_TIMESTAMP(3) AND c.origin='qr' LIMIT 1`,
  [uid, ctx.tenant.id, profile.id, ownerHash, channelRef, chatId]);
  return row || null;
}

async function findStaffClaim(db, { tenantId, profileId, ownerHash, channelRef, identityId, code }) {
  const [[claim]] = await db.query(`SELECT h.id,h.claim_code AS claimCode,h.claimed_identity_id AS staffIdentityId,
      h.owner_uid_hash AS ownerHash,h.conversation_id AS customerChatId,h.channel_ref AS channelRef,
      h.profile_id AS profileId,h.status,h.expires_at AS expiresAt,c.sender_mobile AS customerPhone,
      c.sender_name AS customerName,c.origin
    FROM sx_chatbot_handoff_claims h JOIN sx_legacy_ownership o ON o.tenant_id=h.tenant_id
      AND o.source_table='user' AND o.legacy_uid_hash=h.owner_uid_hash
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    JOIN beta_chats c ON c.uid=u.uid AND BINARY c.chat_id=BINARY h.conversation_id
    WHERE h.tenant_id=? AND h.profile_id=? AND h.owner_uid_hash=? AND h.channel_kind='whatsapp_qr'
      AND h.channel_ref=? AND h.claim_code=? AND h.claimed_identity_id=? AND h.status='claimed'
      AND h.relay_enabled=1 AND h.expires_at>UTC_TIMESTAMP(3) AND c.origin='qr' LIMIT 1 FOR UPDATE`,
  [tenantId, profileId, ownerHash, channelRef, code, identityId]);
  return claim || null;
}

async function staffReply(pool, { ctx, profile, uid, message, sessionId, staff, command, staffChatId }) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const claim = await findStaffClaim(db, { tenantId: ctx.tenant.id, profileId: profile.id,
      ownerHash: sha(uid), channelRef: sessionId, identityId: staff.identityId, code: command.code });
    if (!claim) { await db.commit(); return { handled: true, sent: false, reason: 'STALE_OR_UNASSIGNED_CODE' }; }
    if (command.action === 'close') {
      const reason = `staff-handoff-relay:${claim.id}`;
      const [closed] = await db.query(`UPDATE sx_chatbot_handoff_claims SET status='closed',closed_at=UTC_TIMESTAMP(3),
          closed_identity_id=?,revision=revision+1 WHERE tenant_id=? AND id=? AND status='claimed'
            AND claimed_identity_id=? AND relay_enabled=1`, [staff.identityId, ctx.tenant.id, claim.id, staff.identityId]);
      if (closed.affectedRows !== 1) { await db.rollback(); return { handled: true, sent: false, reason: 'STALE_OR_UNASSIGNED_CODE' }; }
      await db.query(`UPDATE sx_chatbot_conversation_controls SET mode='inherit',pause_until=NULL,reason=NULL,
          revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL
        WHERE tenant_id=? AND channel_kind='whatsapp_qr' AND channel_ref=? AND conversation_id=?
          AND mode='paused' AND updated_by_kind='identity' AND updated_by_identity_id=?
          AND (BINARY reason=BINARY ? OR BINARY reason=BINARY ?)`,
      [ctx.tenant.id, sessionId, claim.customerChatId, staff.identityId, reason, `staff-handoff:${claim.id}`]);
      await db.query(`UPDATE sx_chatbot_handoff_relay_deliveries SET status='suppressed',last_error_code='HANDOFF_CLOSED',
          payload_ciphertext=NULL,payload_iv=NULL,payload_auth_tag=NULL,lease_owner=NULL,lease_until=NULL
        WHERE tenant_id=? AND claim_id=? AND status='pending'`, [ctx.tenant.id, claim.id]);
      await audit(db, { tenantId: ctx.tenant.id, actorIdentityId: staff.identityId, actorKind: 'identity',
        action: 'chatbot.handoff-relay-closed', resourceId: claim.id, changes: { closedBy: staff.identityId, resumed: true } });
      await db.commit();
      const ack = `Handoff ${claim.claimCode} is closed. The assistant will respond to the customer’s next message.`;
      await require('../../automation/functions').sendWaMessage({ origin: 'qr', sessionId,
        message: { senderMobile: staff.phone, senderName: '7Network' }, uid, chatId: null,
        content: { type: 'text', text: { preview_url: false, body: ack } }, senderKind: 'handoff-relay' });
      return { handled: true, closed: true, claimCode: claim.claimCode };
    }
    const [[customer]] = await db.query(`SELECT sender_mobile AS senderMobile,sender_name AS senderName
      FROM beta_chats WHERE uid=? AND BINARY chat_id=BINARY ? AND origin='qr' LIMIT 1 FOR UPDATE`, [uid, claim.customerChatId]);
    if (!customer?.senderMobile) { await db.rollback(); return { handled: true, sent: false, reason: 'CUSTOMER_CHAT_MISSING' }; }
    await db.commit();
    const delivery = await enqueue(pool, { tenantId: ctx.tenant.id, claimId: claim.id, direction: 'staff_to_customer',
      sourceId: sourceMessageId(message), actorIdentityId: staff.identityId,
      payload: { text: command.body, targetPhone: customer.senderMobile, staffPhone: staff.phone,
        staffIdentityId: staff.identityId, staffName: staff.name, targetChatId: claim.customerChatId,
        customerChatId: claim.customerChatId, channelRef: sessionId } });
    if (delivery.created || delivery.status === 'pending') await tick(pool, { limit: 1 }).catch(error => {
      console.warn('[chatbot handoff relay] staff text queue pending', error.code || 'RELAY_QUEUE_PENDING');
    });
    return { handled: true, queued: true, claimCode: claim.claimCode, deliveryStatus: delivery.status };
  } catch (error) {
    await db.rollback().catch(() => {});
    console.warn('[chatbot handoff relay] staff command failed', error.code || 'RELAY_STAFF_COMMAND_FAILED');
    return { handled: true, sent: false, reason: error.code || 'RELAY_STAFF_COMMAND_FAILED' };
  } finally { db.release(); }
}

async function forwardCustomer(pool, { ctx, profile, uid, message, sessionId, claim }) {
  const sourceId = sourceMessageId(message);
  if (!sourceId) return { handled: true, paused: true, reason: 'RELAY_SOURCE_ID_MISSING' };
  const db = await pool.getConnection();
  let staff;
  let staffChatId = null;
  try {
    const permitted = await require('./team-conversation-assignment').eligibleStaff(db, ctx.tenant.id);
    staff = permitted.find(member => member.identityId === claim.staffIdentityId);
    if (!staff) return { handled: true, paused: true, reason: 'RELAY_ASSIGNEE_INACTIVE' };
    const qr = require('./business-whatsapp');
    const phones = await qr.staff(db, ctx.tenant.id, { roles: STAFF_ROLES });
    const assignedPhone = phones.find(item => item.id === staff.identityId)?.phone;
    if (!assignedPhone) return { handled: true, paused: true, reason: 'RELAY_ASSIGNEE_PHONE_MISSING' };
    const [[chat]] = await db.query(`SELECT chat_id AS chatId FROM beta_chats WHERE uid=? AND sender_mobile=? AND origin='qr'
      ORDER BY updated_at DESC LIMIT 1`, [uid, assignedPhone]);
    staffChatId = chat?.chatId || null;
  } finally { db.release(); }
  const messageType = String(message?.type || message?.msgContext?.type || 'text').toLowerCase();
  let body;
  if (messageType !== 'text' && messageType !== 'unknown') {
    body = `Customer ${claim.customerName || ''} sent ${messageType.replace(/_/g, ' ')}. Open the assigned conversation in Inbox to view it. Reply ${claim.claimCode}: <your text> to respond, or CLOSE ${claim.claimCode} to finish.`.trim();
  } else {
    const incomingText = textOf(message);
    body = `Customer message · ${claim.claimCode}\nCustomer: ${claim.customerName || 'Customer'}\n${incomingText}\n\nReply: ${claim.claimCode}: <your reply>\nClose: CLOSE ${claim.claimCode}`;
  }
  const delivery = await enqueue(pool, { tenantId: ctx.tenant.id, claimId: claim.id,
    direction: 'customer_to_staff', sourceId, payload: { text: body, targetPhone: assignedPhone,
      staffPhone: assignedPhone, staffIdentityId: staff.identityId, staffName: staff.name,
      targetChatId: staffChatId, customerChatId: claim.customerChatId, channelRef: sessionId } });
  if (delivery.created || delivery.status === 'pending') await tick(pool, { limit: 1 }).catch(error => {
    console.warn('[chatbot handoff relay] customer text queue pending', error.code || 'RELAY_QUEUE_PENDING');
  });
  return { handled: true, paused: true, relayed: true, deliveryStatus: delivery.status };
}

async function handleInbound({ pool, ctx, profile, uid, message, sessionId, origin, chatId }) {
  if (!pool || !ctx?.tenant?.id || !profile?.id || !uid || !message || message.route !== 'INCOMING'
    || origin !== 'qr' || profile.config?.staffWhatsAppRelayEnabled !== true) return { handled: false };
  const db = await pool.getConnection();
  let staff;
  let claim;
  let dbReleased = false;
  try {
    staff = await currentStaff(db, ctx.tenant.id, message.senderMobile);
    if (staff) {
      db.release();
      dbReleased = true;
      const raw = textOf(message);
      if (staff.ambiguous) {
        await require('../../automation/functions').sendWaMessage({ origin: 'qr', sessionId,
          message: { senderMobile: staff.phone, senderName: '7Network' }, uid, chatId: null,
          content: { type: 'text', text: { preview_url: false, body: 'This WhatsApp number is linked to multiple staff profiles. Please ask the business owner to correct the staff contact records.' } },
          senderKind: 'handoff-relay' });
        return { handled: true, staffMessage: true };
      }
      if (!staff.eligible) {
        await require('../../automation/functions').sendWaMessage({ origin: 'qr', sessionId,
          message: { senderMobile: staff.phone, senderName: '7Network' }, uid, chatId: null,
          content: { type: 'text', text: { preview_url: false, body: 'Your staff account is not currently eligible to claim or handle customer handoffs.' } },
          senderKind: 'handoff-relay' });
        return { handled: true, staffMessage: true };
      }
      const claims = require('./chatbot-handoff-claims');
      if (claims.parseYes(raw)) {
        const parsedYes = claims.parseYes(raw);
        const sourceId = sourceMessageId(message);
        if (sourceId) {
          const [[prior]] = await pool.query(`SELECT h.id,h.claim_code AS claimCode,h.conversation_id AS conversationId
            FROM sx_chatbot_handoff_claims h WHERE h.tenant_id=? AND h.profile_id=? AND h.channel_kind='whatsapp_qr'
              AND h.channel_ref=? AND h.claim_code=? AND h.claimed_identity_id=? AND h.status='claimed'
              AND h.relay_enabled=1 AND h.expires_at>UTC_TIMESTAMP(3) LIMIT 1`,
          [ctx.tenant.id, profile.id, sessionId, parsedYes.code, staff.identityId]);
          if (prior) {
            const reply = `You’ve claimed handoff ${prior.claimCode}. AI replies are paused while it is active.\n\nReply ${prior.claimCode}: <your message> to respond to the customer.\nSend CLOSE ${prior.claimCode} to finish and resume the assistant.\nFor customer media, open the assigned chat in Inbox.`;
            const ack = await enqueue(pool, { tenantId: ctx.tenant.id, claimId: prior.id, direction: 'assignment_ack',
              sourceId, actorIdentityId: staff.identityId, payload: { text: reply, targetPhone: staff.phone,
                staffPhone: staff.phone, staffIdentityId: staff.identityId, staffName: staff.name,
                targetChatId: chatId, customerChatId: prior.conversationId, channelRef: sessionId } });
            if (ack.created || ack.status === 'pending') await tick(pool, { limit: 1 }).catch(() => {});
            return { handled: true, staffMessage: true, handoffClaim: 'claimed', duplicate: true };
          }
        }
        const result = await claims.handleStaffClaim(pool, { ctx, profileId: profile.id, relayEnabled: true,
          uid, message, text: raw, channelKind: 'whatsapp_qr', channelRef: sessionId, chatId });
        if (!result.handled) return { handled: false };
        let reply = 'There are no open staff handoffs to claim.';
        if (result.outcome === 'claimed' && result.relayEnabled) {
          reply = `You’ve claimed handoff ${result.claimCode}. AI replies are paused while it is active.\n\nReply ${result.claimCode}: <your message> to respond to the customer.\nSend CLOSE ${result.claimCode} to finish and resume the assistant.\nFor customer media, open the assigned chat in Inbox.`;
          const eventId = sourceMessageId(message);
          if (eventId) await enqueue(pool, { tenantId: ctx.tenant.id, claimId: result.claimId,
            direction: 'assignment_ack', sourceId: eventId, actorIdentityId: staff.identityId,
            payload: { text: reply, targetPhone: staff.phone, staffPhone: staff.phone, staffIdentityId: staff.identityId,
              staffName: staff.name, targetChatId: chatId, customerChatId: result.conversationId,
              channelRef: sessionId } }).then(() => tick(pool, { limit: 1 })).catch(error => {
              console.warn('[chatbot handoff relay] claim acknowledgement queued', error.code || 'RELAY_ACK_QUEUE_FAILED');
            });
        } else if (result.outcome === 'ambiguous') reply = 'More than one handoff is waiting. Reply YES followed by the six-character code in the alert.';
        else if (result.outcome === 'ambiguous_staff') reply = 'This WhatsApp number is linked to multiple staff profiles. Please ask the business owner to correct the staff contact records.';
        else if (result.outcome === 'not_found') reply = 'That handoff code is no longer open. Check the latest staff alert.';
        else if (result.outcome === 'already_claimed') reply = 'Another team member has already claimed that conversation.';
        else if (result.outcome === 'chat_missing') reply = 'That conversation is no longer available in the Inbox.';
        if (result.outcome !== 'claimed' || !result.relayEnabled) {
          await require('../../automation/functions').sendWaMessage({ origin: 'qr', sessionId,
            message: { senderMobile: staff.phone, senderName: '7Network' }, uid, chatId: null,
            content: { type: 'text', text: { preview_url: false, body: reply } }, senderKind: 'handoff-relay' });
        }
        return { handled: true, staffMessage: true, handoffClaim: result.outcome };
      }
      const command = parseCommand(raw);
      if (command) {
        const outcome = await staffReply(pool, { ctx, profile, uid, message, sessionId, staff, command, staffChatId: chatId });
        if (outcome.reason === 'STALE_OR_UNASSIGNED_CODE') {
          await require('../../automation/functions').sendWaMessage({ origin: 'qr', sessionId,
            message: { senderMobile: staff.phone, senderName: '7Network' }, uid, chatId: null,
            content: { type: 'text', text: { preview_url: false, body: 'That handoff code is closed, expired, or assigned to another staff member.' } },
            senderKind: 'handoff-relay' });
        } else if (outcome.reason === 'CUSTOMER_CHAT_MISSING') {
          await require('../../automation/functions').sendWaMessage({ origin: 'qr', sessionId,
            message: { senderMobile: staff.phone, senderName: '7Network' }, uid, chatId: null,
            content: { type: 'text', text: { preview_url: false, body: 'I could not find the customer chat. Please reply from the Inbox.' } },
            senderKind: 'handoff-relay' });
        }
        return { ...outcome, staffMessage: true };
      }
      const [[active]] = await pool.query(`SELECT claim_code AS claimCode FROM sx_chatbot_handoff_claims
        WHERE tenant_id=? AND profile_id=? AND channel_kind='whatsapp_qr' AND channel_ref=?
          AND claimed_identity_id=? AND relay_enabled=1 AND status='claimed' AND expires_at>UTC_TIMESTAMP(3) LIMIT 1`,
      [ctx.tenant.id, profile.id, sessionId, staff.identityId]);
      if (active?.claimCode) await require('../../automation/functions').sendWaMessage({ origin: 'qr', sessionId,
        message: { senderMobile: staff.phone, senderName: '7Network' }, uid, chatId: null,
        content: { type: 'text', text: { preview_url: false, body: `To reply to the customer, send ${active.claimCode}: followed by your message. Send CLOSE ${active.claimCode} when finished.` } },
        senderKind: 'handoff-relay' });
      return { handled: true, staffMessage: true };
    }
    if (require('./chatbot-mockup').ownsInbox(uid, origin)
      && !require('./chatbot-mockup').liveQrMessageAllowed(profile.config, message)) return { handled: false };
    claim = await lookupCustomerClaim(db, { ctx, profile, uid, channelRef: sessionId, chatId });
  } finally { if (!dbReleased) db.release(); }
  if (!claim) return { handled: false };
  return forwardCustomer(pool, { ctx, profile, uid, message, sessionId, claim });
}

function findClaimId(result) {
  return result?.claimId || null;
}

module.exports = { parseCommand, handleInbound, tick, start, encryptPayload, decryptPayload };
