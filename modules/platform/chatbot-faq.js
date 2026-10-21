'use strict';

const STOP = new Set('the for your our are can you what how want would like tell about please help is do does of to in on at'.split(' '));
function normalize(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' '); }
function keywords(value) { return [...new Set(normalize(value).split(' ').filter(word => word.length > 2 && !STOP.has(word)))]; }
function validateFaqInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('INVALID_FAQ'), { code: 'INVALID_FAQ' });
  const clean = (value, max) => {
    if (value == null) return '';
    if (typeof value !== 'string' || value.length > max) throw Object.assign(new Error('INVALID_FAQ'), { code: 'INVALID_FAQ' });
    return value.trim();
  };
  const faq = { questionEn: clean(input.questionEn, 400), answerEn: clean(input.answerEn, 1600), questionAr: clean(input.questionAr, 400), answerAr: clean(input.answerAr, 1600) };
  if ((!faq.questionEn || !faq.answerEn) && (!faq.questionAr || !faq.answerAr)) throw Object.assign(new Error('FAQ_QUESTION_AND_ANSWER_REQUIRED'), { code: 'FAQ_QUESTION_AND_ANSWER_REQUIRED' });
  if (Math.max(keywords(faq.questionEn).length, keywords(faq.questionAr).length) < 2) throw Object.assign(new Error('FAQ_QUESTION_NEEDS_TWO_WORDS'), { code: 'FAQ_QUESTION_NEEDS_TWO_WORDS' });
  return faq;
}
function findApprovedFaq(message, entries, language = 'en', options = {}) {
  const incoming = new Set(keywords(message));
  if (incoming.size < 2 || !Array.isArray(entries)) return null;
  const matches = entries.map((entry, index) => {
    const question = `${entry?.questionEn || ''} ${entry?.questionAr || ''}`;
    const terms = keywords(question);
    const matched = terms.filter(term => incoming.has(term));
    const financial = /price|fee|cost|discount|رسوم|سعر|تكلفة|خصم/i.test(question);
    return { entry, index, score: matched.length, financial };
  }).filter(item => item.score >= 2 && !(options.hasCourse && item.financial))
    .sort((a, b) => b.score - a.score);
  if (!matches.length || (matches[1] && matches[1].score === matches[0].score)) return null;
  const match = matches[0];
  const answer = match.entry[`answer${language === 'ar' ? 'Ar' : 'En'}`] || match.entry[`answer${language === 'ar' ? 'En' : 'Ar'}`];
  return typeof answer === 'string' && answer.trim() ? { answer: answer.trim(), index: match.index, score: match.score } : null;
}

function mergeKnowledgeEntries(...groups) {
  const seen = { En: new Set(), Ar: new Set() }, result = [];
  for (const item of groups.flat()) {
    if (!item || typeof item !== 'object') continue;
    const entry = {};
    for (const language of ['En', 'Ar']) {
      const question = typeof item[`question${language}`] === 'string' ? item[`question${language}`].trim() : '';
      const answer = typeof item[`answer${language}`] === 'string' ? item[`answer${language}`].trim() : '';
      const key = normalize(question);
      if (!question || !answer || seen[language].has(key)) continue;
      seen[language].add(key);
      entry[`question${language}`] = question;
      entry[`answer${language}`] = answer;
    }
    if (entry.questionEn || entry.questionAr) result.push(entry);
  }
  return result;
}

module.exports = { findApprovedFaq, keywords, validateFaqInput, mergeKnowledgeEntries };
