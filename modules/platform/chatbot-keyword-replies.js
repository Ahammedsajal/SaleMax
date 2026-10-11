'use strict';

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function keywordReply(message, rules, language = 'en') {
  const text = normalize(message);
  if (!text || !Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (rule.enabled === false || !Array.isArray(rule.keywords)) continue;
    const words = rule.keywords.map(normalize).filter(Boolean);
    const includes = word => (` ${text} `).includes(` ${word} `);
    const matches = rule.match === 'exact' ? words.some(word => text === word)
      : rule.match === 'all' ? words.length > 0 && words.every(includes) : words.some(includes);
    const reply = rule.reply?.[language] || rule.reply?.[language === 'ar' ? 'en' : 'ar'];
    if (matches && typeof reply === 'string' && reply.trim()) return reply.trim();
  }
  return null;
}

module.exports = { keywordReply, normalize };
