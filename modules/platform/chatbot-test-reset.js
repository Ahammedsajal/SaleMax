'use strict';
const crypto = require('node:crypto');
const { recipientPhone, recipientAllowed } = require('./chatbot-audience');
const { executionFlowId } = require('./chatbot-profile-utils');

function isTestReset(config, sender, text) {
  const phone = recipientPhone(sender);
  return !!phone && !!config?.testRecipientPhone && phone === config.testRecipientPhone
    && recipientAllowed(config, sender) && /^(?:reset bot|restart bot|إعادة ضبط الروبوت)$/iu.test(String(text || '').trim());
}

async function resetTestConversation(db, { ctx, profile, uid, chatId, origin, sender, turnId }) {
  await db.beginTransaction();
  try {
    const [[current]] = await db.query(`SELECT revision,status,config FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? FOR UPDATE`, [ctx.tenant.id, profile.id]);
    const config = typeof current?.config === 'string' ? JSON.parse(current.config) : current?.config;
    if (current?.status !== 'live' || Number(current.revision) !== Number(profile.revision) || !isTestReset(config, sender, 'reset bot')) throw Object.assign(new Error('TEST_RESET_BUSY'), { code: 'TEST_RESET_BUSY' });
    const [pending] = await db.query(`SELECT id FROM sx_chatbot_turns WHERE tenant_id=? AND conversation_id=? AND id<>? AND status='processing' AND lease_until>UTC_TIMESTAMP(3) FOR UPDATE`, [ctx.tenant.id, chatId, turnId]);
    if (pending.length) throw Object.assign(new Error('TEST_RESET_BUSY'), { code: 'TEST_RESET_BUSY' });
    await db.query(`DELETE FROM sx_chatbot_guided_sessions WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`, [ctx.tenant.id, profile.id, profile.channelKind, profile.channelRef, chatId]);
    if (profile.engine === 'guided' && profile.config.flowId) {
      await db.query(`DELETE FROM flow_session WHERE uid=? AND origin=? AND origin_id=? AND flow_id=? AND sender_mobile=?`, [uid, origin === 'qr' ? 'qr' : 'meta', origin === 'qr' ? profile.channelRef : 'META', executionFlowId(profile), sender]);
    }
    await db.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,revision,updated_by_kind)
      VALUES (?,?,?,?,?,'inherit',1,'system') ON DUPLICATE KEY UPDATE mode='inherit',pause_until=NULL,reason=NULL,revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL`, [crypto.randomUUID(), ctx.tenant.id, profile.channelKind, profile.channelRef, chatId]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'system','chatbot.test-conversation-reset','chatbot-conversation',?,?,?)`, [crypto.randomUUID(), ctx.tenant.id, chatId, JSON.stringify({ profileId: profile.id, channelKind: profile.channelKind, channelRef: profile.channelRef }), crypto.randomUUID()]);
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
}
module.exports = { isTestReset, resetTestConversation };
