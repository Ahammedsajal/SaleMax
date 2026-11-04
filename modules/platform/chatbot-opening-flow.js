'use strict';

const OPENING_GREETINGS = new Set([
  'hi', 'hi there', 'hello', 'hello there', 'hey', 'hey there',
  'good morning', 'good afternoon', 'good evening',
  'مرحبا', 'مرحبا بك', 'اهلا', 'اهلا بك', 'السلام عليكم',
  'السلام عليكم ورحمة الله وبركاته', 'صباح الخير', 'مساء الخير',
]);

function isOpeningGreeting(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
  return OPENING_GREETINGS.has(text);
}

module.exports = { isOpeningGreeting };
