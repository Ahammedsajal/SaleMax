'use strict';

async function dueSessions(db, limit = 10) {
  const [rows] = await db.query(`SELECT id,tenant_id AS tenantId,profile_id AS profileId,channel_kind AS channelKind,channel_ref AS channelRef,
      conversation_id AS conversationId,state
    FROM sx_chatbot_guided_sessions
    WHERE channel_kind='whatsapp_meta'
      AND JSON_UNQUOTE(JSON_EXTRACT(state,'$.step'))='demo_followup'
      AND JSON_EXTRACT(state,'$.demoReminderDueAt') IS NOT NULL
      AND JSON_EXTRACT(state,'$.demoReminderSentAt') IS NULL
      AND STR_TO_DATE(REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(state,'$.demoReminderDueAt')),'T',' '),'Z',''),'%Y-%m-%d %H:%i:%s.%f')<=UTC_TIMESTAMP(3)
    ORDER BY STR_TO_DATE(REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(state,'$.demoReminderDueAt')),'T',' '),'Z',''),'%Y-%m-%d %H:%i:%s.%f'),id
    LIMIT ? FOR UPDATE SKIP LOCKED`, [limit]);
  return rows;
}

function reminderMessage() {
  return { type: 'interactive', interactive: { type: 'button', body: { text: 'Hi! Did you get a chance to watch the 7Network Training Center demo?' }, action: { buttons: [
    { type: 'reply', reply: { id: 'demo_seen_yes', title: 'Yes' } },
    { type: 'reply', reply: { id: 'demo_seen_no', title: 'Not yet' } },
  ] } } };
}

async function tick(pool, { workerId = `sales-prospect-reminders-${process.pid}`, limit = 10, send = null } = {}) {
  const db = await pool.getConnection();
  let rows = [];
  try {
    await db.beginTransaction();
    rows = await dueSessions(db, limit);
    for (const row of rows) {
      const state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state || {};
      state.demoReminderDueAt = null;
      state.demoReminderClaimedAt = new Date().toISOString();
      state.demoReminderAttempts = Number(state.demoReminderAttempts || 0) + 1;
      await db.query('UPDATE sx_chatbot_guided_sessions SET state=?,expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR) WHERE id=?', [JSON.stringify(state), row.id]);
      row.state = state;
    }
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }

  let accepted = 0, suppressed = 0, retried = 0;
  for (const row of rows) {
    try {
      const result = await dispatchOne(pool, row, { send });
      if (result === 'accepted') accepted++;
      else suppressed++;
    } catch (error) {
      retried++;
      if (Number(row.state.demoReminderAttempts) < 3) {
        const retry = await pool.getConnection();
        try {
          const [[current]] = await retry.query('SELECT state FROM sx_chatbot_guided_sessions WHERE id=?', [row.id]);
          const state = typeof current?.state === 'string' ? JSON.parse(current.state) : current?.state || {};
          if (state.step === 'demo_followup' && !state.demoReminderDueAt && !state.demoReminderSentAt && !state.demoReminderCancelledAt) {
            state.demoReminderDueAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            await retry.query('UPDATE sx_chatbot_guided_sessions SET state=? WHERE id=?', [JSON.stringify(state), row.id]);
          }
        } finally { retry.release(); }
      }
      console.error(JSON.stringify({ event: 'sales_prospect_reminder_failed', workerId, code: /^[A-Z0-9_]{2,100}$/.test(error?.code || '') ? error.code : 'REMINDER_SEND_FAILED' }));
    }
  }
  return { claimed: rows.length, accepted, suppressed, retried };
}

async function dispatchOne(pool, row, { send }) {
  const db = await pool.getConnection();
  let uid, profile, ctx, chat;
  try {
    const [[assignment]] = await db.query(`SELECT p.id,p.engine,p.status,p.revision,p.config,p.category_key AS categoryKey,p.category_version AS categoryVersion
      FROM sx_chatbot_profiles p JOIN sx_chatbot_channel_assignments a ON a.tenant_id=p.tenant_id AND a.chatbot_id=p.id
      WHERE p.tenant_id=? AND p.id=? AND p.status='live' AND a.channel_kind='whatsapp_meta' AND a.channel_ref=? LIMIT 1`, [row.tenantId, row.profileId, row.channelRef]);
    if (!assignment) return 'suppressed';
    profile = assignment; profile.config = typeof profile.config === 'string' ? JSON.parse(profile.config) : profile.config;
    const [owners] = await db.query(`SELECT u.uid FROM sx_legacy_ownership o JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND u.role='user'
      WHERE o.tenant_id=? AND o.legacy_uid_hash=CONVERT(SHA2(u.uid,256) USING ascii) COLLATE ascii_bin LIMIT 2`, [row.tenantId]);
    if (owners.length !== 1) return 'suppressed';
    uid = owners[0].uid;
    const [[session]] = await db.query(`SELECT state FROM sx_chatbot_guided_sessions WHERE id=? AND tenant_id=? AND profile_id=?`, [row.id, row.tenantId, row.profileId]);
    const state = typeof session?.state === 'string' ? JSON.parse(session.state) : session?.state || {};
    if (state.step !== 'demo_followup' || state.demoReminderClaimedAt !== row.state.demoReminderClaimedAt || state.demoReminderSentAt || state.demoReminderCancelledAt) return 'suppressed';
    const [[found]] = await db.query('SELECT sender_mobile AS senderMobile,sender_name AS senderName FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1', [uid, row.conversationId]);
    if (!found?.senderMobile) return 'suppressed';
    chat = found;
    const ctxResult = await require('./chatbot-runtime').resolveTenant(uid);
    ctx = ctxResult;
    const message = { senderMobile: chat.senderMobile, senderName: chat.senderName || '', timestamp: Math.floor(Date.now() / 1000), metaChatId: `sales-reminder-${row.id}` };
    const allowed = await require('./chatbot-runtime').canSendNow({ ctx, profile, uid, origin: 'meta', sessionId: row.channelRef, chatId: row.conversationId, message });
    if (!allowed) return 'suppressed';
    const content = reminderMessage();
    const id = send ? await send({ uid, chatId: row.conversationId, sessionId: row.channelRef, message, content }) : await require('../../automation/functions').sendWaMessage({ origin: 'meta', sessionId: row.channelRef, message, uid, chatId: row.conversationId, content });
    if (!id) throw Object.assign(Error('META_REMINDER_NOT_ACCEPTED'), { code: 'META_REMINDER_NOT_ACCEPTED' });
    const sent = { type: 'interactive', metaChatId: id, msgContext: content, reaction: '', timestamp: Math.floor(Date.now() / 1000), senderName: chat.senderName, senderMobile: chat.senderMobile, star: 0, route: 'OUTGOING', context: null, origin: 'meta', sentBy: 'bot' };
    await require('./chatbot-conversation-store').persistConversationMessage({ uid, chatId: row.conversationId, data: { ...sent, msgContext: JSON.stringify(content), context: null } });
    await db.query('UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?', [JSON.stringify(sent), uid, row.conversationId]);
    const [[latest]] = await db.query('SELECT state FROM sx_chatbot_guided_sessions WHERE id=? AND tenant_id=? FOR UPDATE', [row.id, row.tenantId]);
    const latestState = typeof latest?.state === 'string' ? JSON.parse(latest.state) : latest?.state || row.state;
    latestState.demoReminderDueAt = null;
    latestState.demoReminderSentAt = new Date().toISOString();
    await db.query('UPDATE sx_chatbot_guided_sessions SET state=? WHERE id=? AND tenant_id=?', [JSON.stringify(latestState), row.id, row.tenantId]);
    return 'accepted';
  } finally { db.release(); }
}

function start({ env = process.env, pool = require('../../database/config').promise(), intervalMs = 15000 } = {}) {
  if (env.LOCAL_ONLY_MODE === 'true') return { stop() {} };
  let stopped = false, busy = false, timer;
  const loop = async () => {
    if (stopped || busy) return;
    busy = true;
    try { const result = await tick(pool); if (result.claimed) console.log(JSON.stringify({ salesProspectReminders: result })); }
    catch (error) { console.error(JSON.stringify({ event: 'sales_prospect_reminder_worker_failed', code: /^[A-Z0-9_]{2,100}$/.test(error?.code || '') ? error.code : 'WORKER_FAILED' })); }
    finally { busy = false; if (!stopped) timer = setTimeout(loop, intervalMs); }
  };
  timer = setTimeout(loop, intervalMs);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { dueSessions, tick, dispatchOne, start, reminderMessage };
