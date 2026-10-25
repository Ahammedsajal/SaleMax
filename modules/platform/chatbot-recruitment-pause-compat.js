'use strict';

const crypto = require('node:crypto');

const AUTO_REASONS = new Set(['recruitment-awaiting-cv', 'recruitment-complete', 'recruitment-recruiter-requested']);

async function releaseRetiredRecruitmentPause(db, { tenantId, channelKind, channelRef, conversationId }) {
  if (!tenantId || !['whatsapp_meta', 'whatsapp_qr'].includes(channelKind) || !channelRef || !conversationId) return false;
  await db.beginTransaction();
  try {
    const [[control]] = await db.query(`SELECT id,mode,reason,revision,updated_by_kind AS updatedByKind
      FROM sx_chatbot_conversation_controls
      WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?
        AND mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3))
      FOR UPDATE`, [tenantId, channelKind, channelRef, conversationId]);
    if (!control || control.updatedByKind !== 'system' || !AUTO_REASONS.has(control.reason)) {
      await db.commit();
      return false;
    }
    const revision = Number(control.revision);
    const [updated] = await db.query(`UPDATE sx_chatbot_conversation_controls SET mode='inherit',pause_until=NULL,reason=NULL,
      updated_by_kind='system',updated_by_identity_id=NULL,revision=revision+1
      WHERE id=? AND revision=?`, [control.id, revision]);
    if (Number(updated.affectedRows) !== 1) throw Object.assign(Error('CONVERSATION_CONTROL_REVISION_CHANGED'), { code: 'CONVERSATION_CONTROL_REVISION_CHANGED' });
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES(?,?,NULL,'system','chatbot.recruitment-pause-released-for-new-workflow','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), tenantId, conversationId, JSON.stringify({ priorReason: control.reason, revision: revision + 1 }), crypto.randomUUID()]);
    await db.commit();
    return true;
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}

module.exports = { AUTO_REASONS, releaseRetiredRecruitmentPause };
