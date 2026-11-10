'use strict';

function normalized(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[\s\p{P}]+/gu, ' ').trim();
}

function conversationHistoryFromRows(rows, currentMessage = '') {
  const current = normalized(currentMessage);
  const turns = [...(Array.isArray(rows) ? rows : [])].reverse().map(row => {
    if (!['INCOMING', 'OUTGOING'].includes(row?.route)) return null;
    let value = row.msgContext;
    try { if (typeof value === 'string') value = JSON.parse(value); } catch { value = null; }
    const body = value?.text?.body ?? value?.button?.text ?? value?.interactive?.button_reply?.title
      ?? value?.interactive?.list_reply?.title ?? value?.image?.caption ?? value?.video?.caption;
    if (typeof body !== 'string' || !body.trim()) return null;
    return { role: row.route === 'OUTGOING' ? 'assistant' : 'user', text: body.trim().slice(0, 400) };
  }).filter(Boolean);
  const last = turns.at(-1);
  if (last?.role === 'user' && normalized(last.text) === current) turns.pop();
  return turns.slice(-8);
}

module.exports = { conversationHistoryFromRows };
