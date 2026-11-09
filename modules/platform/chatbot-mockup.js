'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { channelFor } = require('./chatbot-channels');
const { redactCustomerText } = require('./chatbot-business-context');

const digest = parts => createHash('sha256').update(parts.join('\0')).digest('hex');
const messageType = value => String(value || 'unknown').match(/^[a-z_]{1,40}$/i)?.[0] || 'unknown';
const tenant = () => process.env.SALEMAX_CHATBOT_MOCKUP_TENANT_ID;
const ownerHash = () => process.env.SALEMAX_CHATBOT_MOCKUP_OWNER_HASH;
const enabled = id => Boolean(id && id === tenant() && /^[a-f0-9]{64}$/.test(ownerHash() || ''));
const ownsInbox = (uid, origin) => Boolean(enabled(tenant()) && channelFor(origin) && typeof uid === 'string' && digest([uid]) === ownerHash());
const safeCode = value => String(value || '').match(/^[a-zA-Z0-9_-]{1,100}$/)?.[0] || null;

async function enqueue(pool, { uid, message, origin, sessionId, chatId }) {
  if (!ownsInbox(uid, origin) || message?.route !== 'INCOMING' || !sessionId || !chatId
    || String(sessionId).length > 191 || String(chatId).length > 255
    || require('./qr-inbox-groups').isGroup({ ...message, chatId })) return false;
  const kind = channelFor(origin);
  const body = message.msgContext?.text?.body ?? message.msgContext?.button?.text
    ?? message.msgContext?.interactive?.button_reply?.title ?? message.msgContext?.interactive?.list_reply?.title
    ?? message.msgContext?.image?.caption ?? message.msgContext?.video?.caption ?? '';
  const text = redactCustomerText(String(body).slice(0, 2000)).trim();
  const providerId = message.metaChatId || digest([message.timestamp, message.type, text]);
  const label = String(message.senderName || message.senderMobile || '').trim().slice(0, 160);
  const [result] = await pool.query(`INSERT INTO sx_chatbot_mockup_turns
    (tenant_id,conversation_key,event_key,channel_kind,channel_ref,chat_id,sender_label,message_type,customer_text,available_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=id`,
  [tenant(), digest([kind, sessionId, chatId]), digest([kind, sessionId, chatId, providerId]),
    kind, sessionId, chatId, label, messageType(message.type), text]);
  return result.affectedRows === 1;
}

async function claim(pool, tenantId) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`UPDATE sx_chatbot_mockup_turns SET status='failed', reason='MOCKUP_RETRY_LIMIT', lease_token=NULL, lease_until=NULL
      WHERE tenant_id=? AND status='processing' AND lease_until<=UTC_TIMESTAMP(3) AND attempts>=3 LIMIT 30`, [tenantId]);
    const [[job]] = await db.query(`SELECT j.* FROM sx_chatbot_mockup_turns j
      WHERE j.tenant_id=? AND ((j.status='queued' AND j.available_at<=UTC_TIMESTAMP(3))
      OR (j.status='processing' AND j.lease_until<=UTC_TIMESTAMP(3) AND j.attempts<3))
      AND NOT EXISTS (SELECT 1 FROM sx_chatbot_mockup_turns p WHERE p.tenant_id=j.tenant_id
        AND p.conversation_key=j.conversation_key AND p.id<j.id AND p.status IN ('queued','processing'))
      ORDER BY j.id LIMIT 1 FOR UPDATE SKIP LOCKED`, [tenantId]);
    if (!job) { await db.commit(); return null; }
    job.lease_token = randomUUID();
    job.attempts = Number(job.attempts) + 1;
    await db.query(`UPDATE sx_chatbot_mockup_turns SET status='processing',attempts=?,lease_token=?,
      lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) WHERE tenant_id=? AND id=?`,
    [job.attempts, job.lease_token, tenantId, job.id]);
    await db.commit();
    return job;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { db.release(); }
}

async function finish(pool, job, result) {
  const status = result.error ? job.attempts >= 3 ? 'failed' : 'queued' : result.wouldHandoff || !result.reply ? 'review' : 'ready';
  await pool.query(`UPDATE sx_chatbot_mockup_turns SET status=?,reply_text=?,state_json=?,route=?,reason=?,profile_revision=?,
    available_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 SECOND),lease_token=NULL,lease_until=NULL
    WHERE tenant_id=? AND id=? AND status='processing' AND lease_token=?`,
  [status, result.reply?.slice(0, 10000) || null, result.state ? JSON.stringify(result.state) : null, safeCode(result.route)?.slice(0, 64) || null,
    safeCode(result.reason) || (result.error ? 'MOCKUP_GENERATION_ERROR' : null), result.revision || null, job.tenant_id, job.id, job.lease_token]);
}

async function tick(pool, { generate = input => require('./chatbot-runtime').previewMockupTurn(input) } = {}) {
  const tenantId = tenant();
  if (!enabled(tenantId)) return false;
  const job = await claim(pool, tenantId);
  if (!job) return false;
  let result;
  try {
    const uid = await require('./chatbot-owner-uid').legacyOwnerUidForTenant(pool, tenantId);
    if (digest([uid]) !== ownerHash()) throw Object.assign(Error('MOCKUP_OWNER_UNAVAILABLE'), { code: 'MOCKUP_OWNER_UNAVAILABLE' });
    const [[previous]] = await pool.query(`SELECT state_json FROM sx_chatbot_mockup_turns
      WHERE tenant_id=? AND conversation_key=? AND id<? AND state_json IS NOT NULL
        AND created_at>=DATE_SUB(?, INTERVAL 24 HOUR) ORDER BY id DESC LIMIT 1`,
    [tenantId, job.conversation_key, job.id, job.created_at]);
    const state = typeof previous?.state_json === 'string' ? JSON.parse(previous.state_json) : previous?.state_json;
    result = await generate({ uid, tenantId, chatId: job.chat_id, channelKind: job.channel_kind,
      channelRef: job.channel_ref, message: job.customer_text, messageType: job.message_type, state });
  } catch (error) {
    result = { error: true, reason: error.code || 'MOCKUP_GENERATION_ERROR' };
    console.warn('[chatbot mockup] draft generation failed', safeCode(result.reason));
  }
  await finish(pool, job, result);
  return true;
}

function start(pool) {
  if (!enabled(tenant())) return;
  let lastCleanup = 0;
  const next = async () => {
    try {
      const more = await tick(pool);
      if (Date.now() - lastCleanup > 60 * 60 * 1000) {
        await pool.query(`DELETE FROM sx_chatbot_mockup_turns WHERE tenant_id=? AND created_at<DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
          AND status IN ('ready','review','failed') ORDER BY id LIMIT 500`, [tenant()]);
        lastCleanup = Date.now();
      }
      setTimeout(next, more ? 100 : 3000).unref();
    } catch (error) {
      console.warn('[chatbot mockup] worker unavailable', safeCode(error.code) || 'MOCKUP_WORKER_ERROR');
      setTimeout(next, 10000).unref();
    }
  };
  setTimeout(next, 1000).unref();
}

async function list(pool, tenantId, before) {
  const [rows] = await pool.query(`SELECT CAST(t.id AS CHAR) AS id,t.conversation_key AS conversationKey,
    t.sender_label AS label,t.status,t.message_type AS messageType,CAST(t.created_at AS CHAR) AS createdAt,g.turnCount
    FROM (SELECT MAX(id) AS last_id,COUNT(*) AS turnCount FROM sx_chatbot_mockup_turns
      WHERE tenant_id=? GROUP BY conversation_key HAVING (? IS NULL OR MAX(id)<?)
      ORDER BY last_id DESC LIMIT 41) g
    JOIN sx_chatbot_mockup_turns t ON t.tenant_id=? AND t.id=g.last_id ORDER BY g.last_id DESC`, [tenantId, before, before, tenantId]);
  const items = rows.slice(0, 40);
  return { items, next: rows.length > 40 ? items.at(-1).id : null };
}

async function thread(pool, tenantId, key, before) {
  const [rows] = await pool.query(`SELECT CAST(id AS CHAR) AS id,sender_label AS label,message_type AS messageType,customer_text AS customerText,
    status,reply_text AS replyText,route,reason,profile_revision AS profileRevision,CAST(created_at AS CHAR) AS createdAt
    FROM sx_chatbot_mockup_turns WHERE tenant_id=? AND conversation_key=? AND (? IS NULL OR id<?)
    ORDER BY id DESC LIMIT 41`, [tenantId, key, before, before]);
  const items = rows.slice(0, 40);
  return { next: rows.length > 40 ? items.at(-1).id : null, items: items.reverse() };
}

function createRouter({ pool, authenticate }) {
  const router = require('express').Router();
  const { decision } = require('./policy');
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.use(authenticate);
  const read = callback => async (req, res) => {
    const ctx = req.featureSession?.context;
    if (ctx?.membership?.role !== 'owner' || !decision(ctx, { capability: 'automation.chatbot', permission: 'automation.manage' }).allowed) {
      return res.status(403).json({ success: false, code: 'PERMISSION_DENIED' });
    }
    if (!enabled(ctx.tenant.id)) return res.status(404).json({ success: false, code: 'MOCKUP_DISABLED' });
    const before = req.query.before ?? null;
    if (before !== null && (typeof before !== 'string' || !/^[1-9]\d{0,15}$/.test(before))) {
      return res.status(400).json({ success: false, code: 'MOCKUP_INVALID_CURSOR' });
    }
    try {
      const data = await callback(ctx.tenant.id, before, req.params.key);
      if (!data) return res.status(404).json({ success: false, code: 'MOCKUP_CONVERSATION_NOT_FOUND' });
      return res.json({ success: true, data });
    } catch (error) {
      console.warn('[chatbot mockup] review unavailable', safeCode(error.code) || 'MOCKUP_READ_ERROR');
      return res.status(503).json({ success: false, code: 'MOCKUP_UNAVAILABLE' });
    }
  };
  router.get('/', read((tenantId, before) => list(pool, tenantId, before)));
  router.get('/conversations/:key', read(async (tenantId, before, key) => {
    if (!/^[a-f0-9]{64}$/.test(key)) return null;
    const data = await thread(pool, tenantId, key, before);
    return data.items.length ? data : null;
  }));
  return router;
}

module.exports = { enabled, ownsInbox, enqueue, start, tick, list, thread, createRouter };
