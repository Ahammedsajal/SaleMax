'use strict';

function flowSessionScope({ uid, origin, sessionId, flowId, senderMobile }) {
  if (!uid || !flowId || !senderMobile) return null;
  return {
    where: 'uid = ? AND origin <=> ? AND origin_id <=> ? AND flow_id = ? AND sender_mobile = ?',
    params: [uid, origin ?? null, sessionId ?? null, flowId, senderMobile],
  };
}

function flowSessionRowScope(flowSession, uid) {
  if (!flowSession?.id || !uid) return null;
  return { where: 'id = ? AND uid = ?', params: [flowSession.id, uid] };
}

module.exports = { flowSessionScope, flowSessionRowScope };
