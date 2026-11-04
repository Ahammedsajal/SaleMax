'use strict';

const OPENING_GREETINGS = new Set([
  'hi', 'hi there', 'hello', 'hello there', 'hey', 'hey there',
  'good morning', 'good afternoon', 'good evening',
  'مرحبا', 'مرحبا بك', 'اهلا', 'اهلا بك', 'السلام عليكم',
  'السلام عليكم ورحمة الله وبركاته', 'صباح الخير', 'مساء الخير',
]);
const OPENING_GREETING_TYPO_ALIASES = new Set(['helo', 'heelo', 'helllo', 'hallo', 'salaam']);

function isOpeningGreeting(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
  if (OPENING_GREETINGS.has(text)) return true;
  if (!text || /\s/u.test(text) || text.length > 14) return false;

  // Accept common greeting typos and repeated final letters (for example,
  // "helo", "hii", and "hellooo") without fuzzy-matching ordinary words.
  const compact = text.replace(/(.)\1+$/u, '$1');
  return OPENING_GREETINGS.has(compact) || OPENING_GREETING_TYPO_ALIASES.has(compact);
}

module.exports = { isOpeningGreeting };
