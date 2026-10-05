'use strict';
const crypto = require('node:crypto');

function parseGuidedFlow(row) {
  try {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges) || data.nodes.length < 2 || data.nodes.length > 120 || data.edges.length > 240 || !data.nodes.some(node => node?.id === 'initialNode')) return null;
    // Chatbot profiles may reuse the graph renderer, but never execute
    // customer-authored HTTP, SQL, JavaScript, or arbitrary extension nodes.
    const allowed = new Set(['INITIAL','INITIAL_NODE','SEND_MESSAGE','SEND_WA_TEMPLATE','CONDITION','RESPONSE_SAVER','DELAY','AGENT_TRANSFER','RESET']);
    if (data.nodes.some(node => {
      const type = String(node?.type || node?.data?.type?.type || '').toUpperCase();
      return !allowed.has(type);
    })) return null;
    return { ...row, ...data };
  } catch { return null; }
}

function executionFlowId(profile) {
  if (!profile || typeof profile.id !== 'string' || typeof profile.channelRef !== 'string' || !profile.id || !profile.channelRef) throw new TypeError('CHATBOT_PROFILE_CHANNEL_REQUIRED');
  return `sx_${crypto.createHash('sha256').update(`${profile.id}\0${profile.channelRef}`).digest('hex').slice(0, 32)}`;
}

function inboundMessageKey(profile, conversationId, providerMessageId) {
  if (!profile || typeof profile.channelKind !== 'string' || typeof profile.channelRef !== 'string' || !conversationId || !providerMessageId) throw new TypeError('CHATBOT_INBOUND_IDENTITY_REQUIRED');
  return crypto.createHash('sha256').update([profile.channelKind, profile.channelRef, conversationId, providerMessageId].join('\0')).digest('hex');
}

module.exports = { parseGuidedFlow, executionFlowId, inboundMessageKey };
