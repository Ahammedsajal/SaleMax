'use strict';
const digits = value => String(value || '').replace(/\D/g, '');
function conversationScope(chat, channels) {
  if (!chat) return null;
  const kind = chat.origin === 'meta' ? 'whatsapp_meta' : chat.origin === 'qr' ? 'whatsapp_qr' : null;
  if (!kind) return null;
  let instance = {};
  try { instance = typeof chat.origin_instance_id === 'string' ? JSON.parse(chat.origin_instance_id) : chat.origin_instance_id || {}; } catch {}
  const unique = chat.origin_instance_unique_id;
  const number = digits(instance.id);
  const candidates = channels.filter(channel => channel.kind === kind);
  const matches = kind === 'whatsapp_qr'
    ? candidates.filter(channel => unique ? String(channel.reference) === String(unique) : number && digits(channel.label) === number)
    : candidates.filter(channel => number && digits(channel.label) === number);
  // A sole connected channel of the recorded origin is unambiguous even when
  // legacy chats do not carry provider metadata. Never guess across numbers.
  const result = matches.length === 1 ? matches[0] : !matches.length && !unique && candidates.length === 1 ? candidates[0] : null;
  return result ? { channelKind: result.kind, channelRef: String(result.reference) } : null;
}
module.exports = { conversationScope };
