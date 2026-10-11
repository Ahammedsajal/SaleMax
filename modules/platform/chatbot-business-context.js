'use strict';
const crypto = require('node:crypto');
const { normalizeDigits } = require('./chatbot-training-guide');
const { keywordReply } = require('./chatbot-keyword-replies');

const normalized = value => normalizeDigits(value).toLowerCase().normalize('NFKC').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP_WORDS = new Set('the for your our are can you what how want would like tell about course courses training please help اريد دورة الدورات التدريب ماهي ممكن لو سمحت'.split(' '));
const tokens = value => normalized(value).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word));
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const local = (item, field, language) => item[field + (language === 'ar' ? 'Ar' : 'En')] || item[field + (language === 'ar' ? 'En' : 'Ar')] || '';

function languageFor(message, state = {}) {
  if (/^(english|en)$/i.test(message.trim())) return 'en';
  if (/[\u0600-\u06ff]/.test(message)) return 'ar';
  if (/[a-z]{3}/i.test(message)) return 'en';
  return state.language === 'ar' ? 'ar' : 'en';
}

function controlRoute(message, config, state = {}) {
  const text = normalized(message);
  // Controls must be whole messages. Natural questions mentioning a course,
  // registration or a staff member must remain conversational.
  if (/^(agent|human|staff|person|talk to (a )?(human|person)|موظف|بشر|موظفة|اريد موظف|ابي موظف)$/.test(text) || /\b(?:speak|talk|connect|transfer|chat)\b.*\b(?:person|human|agent|staff|advisor|team)\b|(?:التحدث|التواصل|تحويل|اكلم).*(?:موظف|فريق|شخص)/.test(text)) return 'human';
  if (/^(hi|hello|hey|good morning|good evening|salam|مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير|menu|back|القائمة|رجوع|0|english|en|arabic|ar|العربية|عربي)$/.test(text)) return 'guided';
  if (/^(courses|course list|show courses|available courses|what courses do you have|الدورات|دورات|عرض الدورات|قائمة الدورات|next|previous|التالي|السابق|form|enquiry form|registration form|نموذج|نموذج التسجيل)$/.test(text)) return 'guided';
  if (/^\d{1,2}$/.test(text) && state.step) return 'guided';
  if (keywordReply(message, config?.guidedContent?.keywordReplies)) return 'keyword';
  return 'answer';
}

function score(query, text) {
  const value = normalized(text), words = new Set(tokens(value));
  return tokens(query).reduce((sum, word) => sum + (words.has(word) ? 3 : value.includes(word) ? 1 : 0), 0);
}

function retrieveContext({ facts, knowledgeEntries = [], message, state = {}, profileRevision = 0 }) {
  const language = languageFor(message, state);
  const courses = facts.filter(item => item.code && !item.kind);
  const direct = courses.filter(item => [item.code, item.nameEn, item.nameAr].some(name => name && normalized(message).includes(normalized(name))));
  const ranked = courses.map(item => ({ item, score: score(message, [item.code, item.nameEn, item.nameAr, item.descriptionEn, item.descriptionAr, item.outcomesEn, item.outcomesAr].join(' ')) }))
    .sort((a, b) => b.score - a.score);
  let selected = direct.length ? direct.slice(0, 3) : ranked.filter(row => row.score >= 3).slice(0, 3).map(row => row.item);
  if (!selected.length && state.selectedCourseCode) selected = courses.filter(item => item.code === state.selectedCourseCode);
  const recommendation = /recommend|compare|difference|best|improve|career|beginner|توصي|تنصح|افضل|مقارن|الفرق|مبتدئ/i.test(message);
  if (!selected.length && recommendation) selected = ranked.slice(0, 3).map(row => row.item);
  const evidence = [];
  const sources = [];
  const add = (id, raw, data) => { sources.push({ id, revision: fingerprint(raw) }); evidence.push({ sourceId: id, ...data }); };
  selected.forEach(course => add('course:' + (course.courseId || course.code), course, {
    kind: 'course', code: course.code, name: local(course, 'name', language),
    description: String(local(course, 'description', language)).slice(0, 350),
    outcomes: String(local(course, 'outcomes', language)).slice(0, 250),
    duration: course.durationValue ? `${course.durationValue} ${course.durationUnit}` : null,
    delivery: course.deliveryMode, offer: course.offer, batches: course.batches?.slice(0, 2),
  }));
  facts.filter(item => item.kind === 'business_profile' || item.kind === 'published_enquiry_form').forEach(item => {
    if (item.kind === 'business_profile') add('business:profile', item, {
      kind: item.kind, name: local(item, 'name', language), about: String(local(item, 'about', language)).slice(0, 450),
      address: local(item, 'address', language), phone: item.phone, email: item.email,
      website: item.website, mapsUrl: item.mapsUrl, openingHours: item.openingHours,
    });
    else if (/enrol|enroll|register|registration|apply|join|form|sign up|تسجيل|سجل|نموذج|اشتراك/i.test(message)) add('form:enquiry', item, { kind: item.kind, url: item.url });
  });
  const faqs = knowledgeEntries.map((item, index) => ({ item, index, score: score(message, item.questionEn + ' ' + item.questionAr) })).filter(row => row.score >= 3 && !/price|fee|cost|discount|seat|batch|start date|رسوم|سعر|خصم|مقاعد|موعد|تاريخ/i.test(row.item.questionEn + ' ' + row.item.questionAr)).sort((a, b) => b.score - a.score).slice(0, 2);
  faqs.forEach(({ item, index }) => add('faq:' + index, { item, profileRevision }, { kind: 'approved_faq', question: local(item, 'question', language), answer: local(item, 'answer', language) }));
  // Names are a discovery index, never evidence for unpublished prices/policies.
  add('catalogue:index', courses.map(item => ({code:item.code,nameEn:item.nameEn,nameAr:item.nameAr})), { kind: 'course_index', names: courses.slice(0, 60).map(item => local(item, 'name', language)), totalCourses: courses.length, complete: courses.length < 500 && courses.length <= 60 });
  return { evidence, sources, selectedCourseCode: selected.length === 1 ? selected[0].code : null, language, revision: fingerprint({ facts, knowledgeEntries, profileRevision }), explicitCourses: direct.length };
}

function validateAnswer(response, context) {
  if (!response.canAnswer || !response.reply) return { valid: false, code: 'UNANSWERED' };
  const ids = response.sourceIds;
  const known = new Set(context.sources.map(source => source.id));
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !known.has(id))) return { valid: false, code: 'ANSWER_SOURCE_INVALID' };
  const evidence = context.evidence.filter(item => ids.includes(item.sourceId));
  const raw = JSON.stringify(evidence);
  const reply = normalizeDigits(response.reply).replace(/’/g, "'");
  if (/\b(?:send|share|provide|enter)\b.{0,45}\b(?:password|otp|one.time code|card number|passport|identity document)\b|(?:ارسل|شارك|ادخل).{0,45}(?:كلمة المرور|رمز التحقق|رقم البطاقة|جواز)/i.test(reply)) return { valid: false, code: 'ANSWER_SENSITIVE_REQUEST' };
  const amounts = evidence.filter(item => item.kind === 'course').flatMap(item => [item.offer?.priceAmount, item.offer?.registrationFeeAmount]).filter(value => value != null).map(Number);
  for (const match of reply.matchAll(/(?:QAR|QR|ر\.ق|ريال)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:QAR|QR|ر\.ق|ريال)/gi)) {
    if (!amounts.includes(Number((match[1] || match[2]).replace(/,/g, '')))) return { valid: false, code: 'ANSWER_PRICE_INVALID' };
  }
  for (const url of reply.match(/https?:\/\/[^\s<>]+/g) || []) {
    if (!raw.includes(url.replace(/[.,؛)]+$/, ''))) return { valid: false, code: 'ANSWER_LINK_INVALID' };
  }
  const permittedNumbers = new Set((normalizeDigits(raw).match(/\d+(?:[.,]\d+)?/g) || []).map(n => Number(n.replace(/,/g, ''))));
  // All numeric assertions need evidence; this also checks translated dates,
  // telephone numbers, fees, hours, seats and numeric certificate claims.
  for (const number of reply.match(/\d+(?:[.,]\d+)?/g) || []) {
    if (!permittedNumbers.has(Number(number.replace(/,/g, '')))) return { valid: false, code: 'ANSWER_NUMBER_INVALID' };
  }
  if (/\b(?:i have|i've|we have|we've|you are|you're)\s+(?:booked|enrolled|registered|reserved|confirmed your)|تم (?:تسجيلك|حجز|تأكيد تسجيلك)/i.test(reply)) return { valid: false, code: 'ANSWER_COMMITMENT_INVALID' };
  return { valid: true };
}

function clarification(config, language) {
  const text = config?.guidedContent?.messages?.clarificationMessage;
  return text?.[language] || (language === 'ar' ? 'حتى أساعدك بشكل أدق، أي دورة تهمك؟ وإذا أردت التحدث مع فريقنا، اكتب موظف.' : 'Happy to help — which course are you interested in? If you’d prefer our team, just type agent.');
}

function simpleFactualReply(message, context) {
  const text = normalized(message), ar = context.language === 'ar';
  const courses = context.evidence.filter(item => item.kind === 'course');
  if (courses.length !== 1 || /compare|recommend|difference|best|better|cheaper|and|مقارن|افضل|الفرق|تنصح/.test(text)) return null;
  const course = courses[0];
  if (/^(?:what is |what s |how much is |how much does |tell me |please |كم |ما |اريد معرفة )?(?:the )?(?:fee|fees|price|cost|رسوم|سعر|تكلفة)/.test(text) || /^(?:how much|كم السعر|كم الرسوم)$/.test(text)) {
    if (!course.offer?.priceAmount) return null;
    const fee = `${course.offer.priceAmount} ${course.offer.currency}`;
    const extra = Number(course.offer.registrationFeeAmount) > 0 ? (ar ? ` ورسوم التسجيل ${course.offer.registrationFeeAmount} ${course.offer.currency}.` : ` Registration is ${course.offer.registrationFeeAmount} ${course.offer.currency}.`) : '';
    return { reply: ar ? `رسوم ${course.name} حالياً ${fee}.${extra}` : `${course.name} is currently ${fee}.${extra}`, sourceIds: [course.sourceId] };
  }
  return null;
}

function previewState(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 4000) throw Object.assign(new Error('INVALID_PREVIEW_STATE'), { code: 'INVALID_PREVIEW_STATE' });
  const result = {};
  for (const key of ['step', 'language', 'selectedCourseCode']) if (typeof value[key] === 'string' && value[key].length <= 80) result[key] = value[key];
  if (typeof value.greeted === 'boolean') result.greeted = value.greeted;
  if (Number.isSafeInteger(value.page) && value.page >= 0 && value.page <= 250) result.page = value.page;
  if (Array.isArray(value.courseCodes)) result.courseCodes = value.courseCodes.filter(item => typeof item === 'string' && item.length <= 40).slice(0, 9);
  if (Array.isArray(value.recentConversation)) result.recentConversation = value.recentConversation.slice(-4).filter(item => ['user', 'assistant'].includes(item?.role) && typeof item.text === 'string').map(item => ({ role: item.role, text: item.text.slice(0, 500) }));
  return result;
}

function redactCustomerText(value) {
  return String(value || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email omitted]')
    .replace(/\+?\d(?:[ -]?\d){6,}/g, '[number omitted]')
    .replace(/(?:password|otp|one.time code|كلمة المرور|رمز التحقق)\s*[:=]?\s*\S+/gi, '[sensitive detail omitted]');
}

module.exports = { normalized, fingerprint, languageFor, controlRoute, retrieveContext, validateAnswer, clarification, simpleFactualReply, previewState, redactCustomerText };
