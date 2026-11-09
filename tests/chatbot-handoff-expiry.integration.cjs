'use strict';

const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const handoffs = require('../modules/platform/chatbot-handoff-claims');

module.exports = async function handoffExpiryIntegration(db, pool, { t1, t2, i1, i2 }) {
  const key = 'SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID';
  const original = process.env[key];
  process.env[key] = t1;
  const uid = 'synthetic-handoff-owner';
  const ownerHash = createHash('sha256').update(uid).digest('hex');
  const channelRef = 'synthetic-handoff-qr';
  const reason = 'test-handoff';
  const profiles = {};
  const addHandoff = async (tenantId, identityId, name, status, due, manual = false) => {
    const conversationId = 'expiry-test-' + name;
    const claim = await handoffs.open(db, { ctx: { tenant: { id: tenantId } }, profile: { id: profiles[tenantId] },
      uid, chatId: conversationId, channelKind: 'whatsapp_qr', channelRef, reason });
    const [[deadline]] = await db.query('SELECT TIMESTAMPDIFF(MINUTE,UTC_TIMESTAMP(3),expires_at) AS minutes FROM sx_chatbot_handoff_claims WHERE id=?', [claim.id]);
    const expected = tenantId === t1 ? 60 : 1440;
    assert.ok([expected - 1, expected].includes(Number(deadline.minutes)));
    if (due) await db.query('UPDATE sx_chatbot_handoff_claims SET expires_at=UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id=?', [claim.id]);
    if (status === 'claimed') await db.query(`UPDATE sx_chatbot_handoff_claims
      SET status='claimed',claimed_identity_id=?,claimed_at=UTC_TIMESTAMP(3) - INTERVAL 2 MINUTE WHERE id=?`, [identityId, claim.id]);
    await db.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,reason,updated_by_kind,updated_by_identity_id,updated_at)
      SELECT ?,tenant_id,channel_kind,channel_ref,conversation_id,'paused',IF(?,NULL,expires_at),reason,IF(status='claimed','identity','system'),
        claimed_identity_id,IF(?,UTC_TIMESTAMP(3),COALESCE(claimed_at,UTC_TIMESTAMP(3))) FROM sx_chatbot_handoff_claims WHERE id=?`,
    [randomUUID(), manual, manual, claim.id]);
    return { ...claim, conversationId };
  };
  const status = async (tenantId, claim) => {
    const [[row]] = await db.query(`SELECT h.status,c.mode FROM sx_chatbot_handoff_claims h
      JOIN sx_chatbot_conversation_controls c ON c.tenant_id=h.tenant_id AND c.channel_kind=h.channel_kind
        AND c.channel_ref=h.channel_ref AND c.conversation_id=h.conversation_id WHERE h.tenant_id=? AND h.id=?`, [tenantId, claim.id]);
    return [row.status, row.mode];
  };
  try {
    await db.query('CREATE TABLE IF NOT EXISTS beta_chats (uid VARCHAR(999),chat_id VARCHAR(999),sender_mobile VARCHAR(80),origin VARCHAR(20))');
    for (const [tenantId, identityId] of [[t1, i1], [t2, i2]]) {
      profiles[tenantId] = randomUUID();
      await db.query(`INSERT INTO sx_chatbot_profiles(id,tenant_id,category_key,category_version,name,engine,config,created_by_identity_id,updated_by_identity_id)
        VALUES (?,?,'training_center',1,'Synthetic expiry bot','hybrid',JSON_OBJECT(),?,?)`, [profiles[tenantId], tenantId, identityId, identityId]);
    }
    const waiting = await addHandoff(t1, i1, 'waiting', 'open', true);
    const claimed = await addHandoff(t1, i1, 'claimed', 'claimed', true);
    const manual = await addHandoff(t1, i1, 'manual', 'claimed', true, true);
    const future = await addHandoff(t1, i1, 'future', 'open', false);
    const other = await addHandoff(t2, i2, 'other', 'claimed', true);

    const taskId = randomUUID(), eventId = randomUUID();
    await db.query(`INSERT INTO sx_tasks(id,tenant_id,uid_hash,title,task_type,created_by_type,created_by_id)
      VALUES (?,?,?,'Synthetic task','chatbot_handoff','identity',?)`, [taskId, t1, ownerHash, i1]);
    await db.query('UPDATE sx_chatbot_handoff_claims SET handoff_task_id=? WHERE id=?', [taskId, waiting.id]);
    await db.query(`INSERT INTO sx_business_notification_events(id,tenant_id,event_key,kind,source_type,source_id)
      VALUES (?,?,?,'chatbot_handoff','chatbot_handoff',?)`, [eventId, t1, waiting.notificationEventKey, waiting.id]);
    await db.query(`INSERT INTO sx_business_notification_deliveries(tenant_id,event_id,recipient_kind,recipient_id,destination_hash,part,status)
      VALUES (?,?,'identity',?,?,'text','queued'),(?,?,'identity',?,?,'text','accepted')`,
    [t1, eventId, i1, 'a'.repeat(64), t1, eventId, i1, 'b'.repeat(64)]);
    await db.query(`INSERT INTO sx_chatbot_guided_sessions(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,conversation_hash,state,expires_at)
      VALUES (?,?,?,'whatsapp_qr',?,?,UNHEX(SHA2(?,256)),JSON_OBJECT(),UTC_TIMESTAMP(3) + INTERVAL 1 DAY)`,
    [randomUUID(), t1, profiles[t1], channelRef, waiting.conversationId, waiting.conversationId]);

    const results = await Promise.all([handoffs.expireDue(pool), handoffs.expireDue(pool, { tenantId: t1 })]);
    assert.equal(results.reduce((sum, item) => sum + item.expired, 0), 3);
    assert.equal(results.reduce((sum, item) => sum + item.guidedSessionsReset, 0), 1);
    assert.deepEqual(await status(t1, waiting), ['expired', 'inherit']);
    assert.deepEqual(await status(t1, claimed), ['expired', 'inherit']);
    assert.deepEqual(await status(t1, manual), ['expired', 'paused']);
    assert.deepEqual(await status(t1, future), ['open', 'paused']);
    assert.deepEqual(await status(t2, other), ['claimed', 'paused']);
    assert.equal((await db.query('SELECT status FROM sx_tasks WHERE id=?', [taskId]))[0][0].status, 'canceled');
    assert.deepEqual((await db.query('SELECT status FROM sx_business_notification_deliveries WHERE event_id=? ORDER BY id', [eventId]))[0].map(row => row.status),
      ['suppressed', 'accepted']);

    await assert.rejects(handoffs.expireDue(pool, { tenantId: t1, resetAll: true, beforeReset: async () => { throw Error('snapshot-failed'); } }), /snapshot-failed/);
    assert.deepEqual(await status(t1, future), ['open', 'paused']);
    const reset = await handoffs.expireDue(pool, { tenantId: t1, resetAll: true, beforeReset: async (_db, rows) => {
      assert.deepEqual(rows.map(row => row.id), [future.id]);
    } });
    assert.equal(reset.expired, 1);
    assert.deepEqual(await status(t1, future), ['expired', 'inherit']);
    return { handoffExpiry: true, handoffResetTenantIsolation: true, handoffResetRollback: true };
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
};
