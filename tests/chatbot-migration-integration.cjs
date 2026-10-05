'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

module.exports = async function chatbotMigrationIntegration(connection, { t1, t2, i1, i2 }) {
  const ownerBot = crypto.randomUUID(), otherBot = crypto.randomUUID();
  for (const [id, tenantId, identityId, name] of [[ownerBot, t1, i1, 'Synthetic training bot'], [otherBot, t2, i2, 'Other tenant bot']]) {
    await connection.query(`INSERT INTO sx_chatbot_profiles(id,tenant_id,category_key,category_version,name,engine,status,config,created_by_identity_id,updated_by_identity_id)
      VALUES (?,?, 'training_center',1,?,'hybrid','draft',JSON_OBJECT('flowId','synthetic'),?,?)`, [id, tenantId, name, identityId, identityId]);
  }
  const addChannel = (id, tenantId, chatbotId, identityId, ref) => connection.query(`INSERT INTO sx_chatbot_channel_assignments(id,tenant_id,chatbot_id,channel_kind,channel_ref,assigned_by_identity_id) VALUES (?,?,?,'whatsapp_qr',?,?)`, [id, tenantId, chatbotId, ref, identityId]);
  const channelId = crypto.randomUUID(), channelRef = `test-${channelId}`;
  await addChannel(channelId, t1, ownerBot, i1, channelRef);
  await assert.rejects(addChannel(crypto.randomUUID(), t1, ownerBot, i1, channelRef), { code: 'ER_DUP_ENTRY' });
  await assert.rejects(addChannel(crypto.randomUUID(), t1, otherBot, i1, `other-${crypto.randomUUID()}`), error => ['ER_NO_REFERENCED_ROW_2','ER_NO_REFERENCED_ROW'].includes(error.code));

  const conversationId = `synthetic-${crypto.randomUUID()}`;
  const control = crypto.randomUUID();
  await connection.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,reason,revision,updated_by_kind,updated_by_identity_id) VALUES (?,?, 'whatsapp_qr',?,?, 'paused','synthetic',1,'identity',?)`, [control, t1, channelRef, conversationId, i1]);
  // A repeated contact ID on another connected number has independent state.
  await connection.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,reason,revision,updated_by_kind,updated_by_identity_id) VALUES (?,?, 'whatsapp_meta',?,?, 'paused','LOW_CONFIDENCE',1,'system',NULL)`, [crypto.randomUUID(), t1, `meta-${channelRef}`, conversationId]);
  await connection.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,reason,revision,updated_by_kind,updated_by_identity_id) VALUES (?,?, 'whatsapp_qr',?,?, 'paused','LOW_CONFIDENCE',1,'system',NULL)`, [crypto.randomUUID(), t1, channelRef, `system-${conversationId}`]);
  await assert.rejects(connection.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,revision,updated_by_kind,updated_by_identity_id) VALUES (?,?, 'whatsapp_qr',?,?, 'paused',1,'identity',NULL)`, [crypto.randomUUID(), t1, channelRef, `bad-${conversationId}`]));

  const inbound = crypto.createHash('sha256').update(conversationId).digest('hex');
  const insertTurn = (tenantId, profileId, id) => connection.query(`INSERT INTO sx_chatbot_turns(id,tenant_id,conversation_id,inbound_message_id,profile_id,status,attempts,lease_until) VALUES (?,?,?, ?,?,'processing',1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 45 SECOND))`, [id, tenantId, conversationId, inbound, profileId]);
  const turnId = crypto.randomUUID();
  await insertTurn(t1, ownerBot, turnId);
  await assert.rejects(insertTurn(t1, ownerBot, crypto.randomUUID()), { code: 'ER_DUP_ENTRY' });
  await insertTurn(t2, otherBot, crypto.randomUUID());
  await connection.query(`DELETE FROM sx_chatbot_profiles WHERE tenant_id=? AND id=?`, [t1, ownerBot]);
  const [[counts]] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM sx_chatbot_channel_assignments WHERE tenant_id=? AND chatbot_id=?) AS channels,
      (SELECT COUNT(*) FROM sx_chatbot_turns WHERE tenant_id=? AND profile_id=?) AS turns`, [t1, ownerBot, t1, ownerBot]);
  assert.equal(Number(counts.channels), 0);
  assert.equal(Number(counts.turns), 0);
  return { tenantBoundProfiles: true, uniqueNumberAssignment: true, crossTenantBotReferenceRejected: true, channelScopedConversationControls: true, identityAndSystemConversationActors: true, conversationActorCheck: true, inboundIdempotency: true, profileDeleteCascades: true };
};
