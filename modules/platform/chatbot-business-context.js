'use strict';
const crypto = require('node:crypto');
const { isOpeningGreeting } = require('./chatbot-opening-flow');
const { normalizeDigits } = require('./chatbot-training-guide');
const { keywordReply } = require('./chatbot-keyword-replies');
const { findApprovedFaq, keywords: faqKeywords } = require('./chatbot-faq');

const normalized = value => normalizeDigits(value).toLowerCase().normalize('NFKC').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP_WORDS = new Set('the for your our are can you what how want would like tell about course courses training please help certificate certification professional class classes session sessions certificates certifications accreditation accredited attestation attested certified شهادة الشهادة شهادات الشهادات اعتماد معتمدة تصديق مصدقة احترافي اريد دورة الدورات التدريب ماهي ممكن لو سمحت'.split(' '));
const tokens = value => normalized(value).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word));
function isBareCourseSelection(message, context) {
  if (Number(context?.explicitCourses) !== 1 || !context?.selectedCourseCode) return false;
  const words = normalized(message).split(/\s+/u).filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;
  return !/\b(?:what|which|who|where|when|why|how|can|could|would|should|is|are|do|does|did|tell|explain|details?|information|info|price|fee|cost|duration|long|schedule|batch|certificate|certification|accreditation|online|offline|compare|recommend|need|want|please|about|prerequisites?|requirements?|outcomes?|level|beginners?|address|location)\b|متطلبات|مخرجات|نواتج|المبتدئين|مستوى|عنوان|[?؟]/iu.test(String(message || ''));
}
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const COURSE_TOPIC_AR = new Map([
  ['ms word', 'Word: إنشاء المستندات وتنسيقها وإعداد التقارير الاحترافية'],
  ['ms excel', 'Excel: استخدام الصيغ والجداول المحورية وتحليل البيانات'],
  ['ms powerpoint', 'PowerPoint: إعداد العروض التقديمية والمحتوى المرئي'],
  ['ai tools', 'أدوات الذكاء الاصطناعي: مقدمة عملية للاستخدام في بيئة العمل'],
  ['google sheets', 'Google Sheets: العمل على البيانات عبر الإنترنت والتعاون'],
  ['google workspace', 'Google Workspace: أدوات أساسية للعمل'],
]);
const durationUnit = (unit, amount, language) => { const ar = {hours:['ساعة','ساعتان','ساعات'],days:['يوم','يومان','أيام'],weeks:['أسبوع','أسبوعان','أسابيع'],months:['شهر','شهران','أشهر']}; return language === 'ar' && ar[unit] ? ar[unit][Number(amount) === 2 ? 1 : Number(amount) >= 3 && Number(amount) <= 10 ? 2 : 0] : Number(amount) === 1 ? String(unit).replace(/s$/, '') : unit; };
function publishedDurationRange(descriptionEn, descriptionAr, language = 'en') {
  const arabicDigits = value => String(value).replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10));
  const lines = [descriptionEn, descriptionAr].filter(Boolean).flatMap(value => String(value).split(/[\r\n]+/));
  for (const rawLine of lines) {
    const line = arabicDigits(rawLine);
    const match = line.match(/(?:^|\s)(\d{1,3})\s*(?:–|—|−|-|to)\s*(\d{1,3})\s*(hours?|days?|weeks?|months?|ساعات?|أيام?|ايام?|أسابيع?|اسابيع?|أشهر?|اشهر?)(?=\s|$)/iu);
    if (!match || !/(?:training|course|duration|تدريب|دورة|مدة)/iu.test(line)) continue;
    const min = Number(match[1]), max = Number(match[2]);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) continue;
    const unit = /hour|ساعة|ساع/iu.test(match[3]) ? 'hours'
      : /day|يوم|أيام|ايام/iu.test(match[3]) ? 'days'
        : /month|شهر|أشهر|اشهر/iu.test(match[3]) ? 'months' : 'weeks';
    if (language === 'ar') return `${min}–${max} ${durationUnit(unit, max, 'ar')}`;
    const englishUnit = unit === 'hours' ? 'hours' : unit === 'days' ? 'days' : unit === 'months' ? 'months' : 'weeks';
    return `${min}–${max} ${englishUnit}`;
  }
  return null;
}
const local = (item, field, language) => item[field + (language === 'ar' ? 'Ar' : 'En')] || item[field + (language === 'ar' ? 'En' : 'Ar')] || '';

function languageFor(message, state = {}) {
  if (/^(english|en)$/i.test(message.trim())) return 'en';
  if (/[\u0600-\u06ff]/.test(message)) return 'ar';
  if (/[a-z]{3}/i.test(message)) return 'en';
  return state.language === 'ar' ? 'ar' : 'en';
}

function isCertificateQuestion(message, facts = []) {
  let text = ` ${normalized(message)} `;
  if (!/\b(?:certificates?|certifications?|certified|accreditation|accredited|attestation|attested|legalized|legalised)\b|شهاد[ةات]|الشهادات|اعتماد|معتمد|تصديق|مصدق/u.test(text)) return false;
  for (const item of facts) {
    if (item.kind && item.kind !== 'course') continue;
    for (const name of [item.name, item.nameEn, item.nameAr]) {
      if (name) text = text.replaceAll(` ${normalized(name)} `, ' ');
    }
  }
  return /\b(?:certificates?|certifications?|accreditation|accredited|attestation|attested|legalized|legalised)\b|\b(?:is|are)\b.{0,60}\bcertified\b|شهاد[ةات]|الشهادات|اعتماد|معتمد|تصديق|مصدق/u.test(text);
}

function controlRoute(message, config, state = {}, facts = [], { courseCertificates = false } = {}) {
  const text = normalized(message);
  // Controls must be whole messages. Natural questions mentioning a course,
  // registration or a staff member must remain conversational.
  if (/^(agent|human|staff|person|talk to (a )?(human|person)|موظف|بشر|موظفة|اريد موظف|ابي موظف)$/.test(text) || /\b(?:speak|talk|connect|transfer|chat)\b.*\b(?:person|human|agent|staff|advisor|team)\b|(?:التحدث|التواصل|تحويل|اكلم).*(?:موظف|فريق|شخص)/.test(text)) return 'human';
  if (/\b(?:image|photo|picture|screenshot|document|file|voice note|audio|video|location pin)\b|\b(?:shared|sent|dropped) my location\b|\b(?:attached|sent|shared|uploaded)\b.{0,45}\b(?:media|attachment|file)\b|ارفق|مرفق|صورة|ملف|مقطع صوت|رسالة صوتية|فيديو|موقعي/u.test(text)) return 'handoff';
  if (/\b(?:job|jobs|career|careers|employment|vacancy|vacancies|hiring|recruitment|recruiter|cv|resume|work permit)\b|وظيفة|وظائف|توظيف|فرصة عمل|فرص عمل|سيرة ذاتية/u.test(text)) return 'handoff';
  const existingStudentQuestion = /\b(?:existing student|current student|already enrolled|already registered|my registration|my account|my certificate|collect (?:the|a) certificate|student account|payment|paid|receipt|invoice|refund|complaint|not received|haven't received|have not received)\b|شهادتي|استلام الشهادة|طالب حالي|طالبة حالية|انا طالب|انا طالبة|مسجل مسبقا|مسجلة مسبقة|حسابي|مشكلتي|شكوى|شكوي|استرداد|استرجاع|مشكلة دفع|مشكلة في الدفع|لم يصلني|ما وصلني|لم استلم|ما استلمت/u.test(text);
  if (existingStudentQuestion) return 'handoff';
  if (isCertificateQuestion(message, facts)) {
    if (courseCertificates) return 'certificate';
    const context = retrieveContext({ facts, message, state });
    return context.selectedCourseCode && context.evidence.some(item => item.kind === 'course' && item.certificateDetails) ? 'answer' : 'handoff';
  }
  if (/^(hi|hello|hey|good morning|good evening|salam|مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير|menu|back|القائمة|رجوع|0|english|en|arabic|ar|العربية|عربي)$/.test(text)) return 'guided';
  if (/^(courses|course list|show courses|available courses|what courses do you have|الدورات|دورات|عرض الدورات|قائمة الدورات|next|previous|التالي|السابق|form|enquiry form|registration form|نموذج|نموذج التسجيل)$/.test(text)) return 'guided';
  if (/^\d{1,2}$/.test(text) && state.step) return 'guided';
  if (keywordReply(message, config?.guidedContent?.keywordReplies)) return 'keyword';
  return 'answer';
}

function isScheduleQuestion(message) {
  const text = normalized(message);
  return /\b(?:schedule|timetable|batch|batches|start date|start time|when does .{0,45} start|when is the next intake|class timing|next class)\b|مواعيد|جدول|دفعة|موعد البدء|متى تبدأ|متى يبدا|متى يبدأ/u.test(text);
}

function hasPublishedSchedule(facts, selectedCourseCode = null) {
  const courses = (Array.isArray(facts) ? facts : []).filter(item => item?.code && !item.kind);
  const relevant = selectedCourseCode ? courses.filter(item => item.code === selectedCourseCode) : courses;
  return relevant.some(item => Array.isArray(item.batches) && item.batches.length > 0);
}

function courseDetailNeedsCoordinator(message, facts, selectedCourseCode = null) {
  if (!selectedCourseCode) return false;
  const text = normalized(message);
  const course = (Array.isArray(facts) ? facts : []).find(item => item?.code === selectedCourseCode && !item.kind);
  if (!course) return true;
  const description = normalized([course.descriptionEn, course.descriptionAr].filter(Boolean).join(' '));
  const durationQuestion = /\b(?:duration|how long|length of the course|weeks|months|hours)\b|مدة|كم تستغرق|كم مدة/u.test(text);
  const deliveryQuestion = /\b(?:delivery mode|how is .{0,40} delivered|online|in person|face to face|classroom|remote|hybrid delivery)\b|طريقة الدراسة|كيف تقدم|حضوري|عن بعد|اونلاين/u.test(text);
  const durationPublished = course.durationValue != null && course.durationUnit || /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hours?|days?|weeks?|months?)\b|(?:\d+|واحد|واحدة|اثنان|اثنين|ثلاثة|ثلاث|اربعة|خمسة|خمس|ستة|ست|سبعة|سبع|ثمانية|ثمان|تسعة|تسع|عشرة|عشر)\s*(?:ساعة|ساعات|يوم|ايام|اسبوع|اسابيع|شهر|اشهر)/u.test(description);
  const deliveryPublished = Boolean(course.deliveryMode) || /\b(?:online|in person|face to face|classroom|remote|hybrid)\b|عن بعد|حضوري|اونلاين/u.test(description);
  return (durationQuestion && !durationPublished) || (deliveryQuestion && !deliveryPublished);
}

function trainingCenterCoordinatorReason(message, facts, selectedCourseCode = null) {
  if (isScheduleQuestion(message) && !hasPublishedSchedule(facts, selectedCourseCode)) return 'SCHEDULE_REQUIRES_COORDINATOR';
  if (courseDetailNeedsCoordinator(message, facts, selectedCourseCode)) return 'COURSE_DETAIL_REQUIRES_COORDINATOR';
  return null;
}

function score(query, text) {
  const value = normalized(text), words = new Set(tokens(value));
  return tokens(query).reduce((sum, word) => sum + (words.has(word) ? 3 : value.includes(word) ? 1 : 0), 0);
}

function qrAdReferral(message) {
  const bounded = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  for (let depth = 0; message && depth < 5; depth++) {
    const ad = Object.values(message).find(item => item?.contextInfo?.externalAdReply)?.contextInfo.externalAdReply;
    const sourceId = bounded(ad?.sourceId, 191);
    const clickId = bounded(ad?.ctwaClid, 255);
    if (clickId || (sourceId && bounded(ad?.sourceType, 32).toLowerCase() === 'ad')) {
      return { source_type: 'ad', source_id: sourceId, ctwa_clid: clickId,
        headline: bounded(ad.title, 500), body: bounded(ad.body, 1000), source_url: bounded(ad.sourceUrl, 2000) };
    }
    message = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message.viewOnceMessageV2?.message;
  }
  return null;
}

function courseFromVerifiedReferral(facts, referral) {
  if (referral?.source_type !== 'ad' || !(referral.source_id || referral.ctwa_clid)) return null;
  const fields = [referral.headline, referral.body, referral.source_url]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => normalized(decodeURIComponentSafe(value)));
  if (!fields.length) return null;
  const courses = (Array.isArray(facts) ? facts : []).filter(item => item?.code && !item.kind);
  const matches = courses.filter(course => {
    const names = [course.code, course.nameEn, course.nameAr].filter(Boolean).map(normalized);
    return names.some(name => name.length >= 3 && fields.some(field => (` ${field} `).includes(` ${name} `)));
  });
  return matches.length === 1 ? matches[0] : null;
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; }
}

function retrieveContext({ facts, knowledgeEntries = [], message, state = {}, profileRevision = 0, referral = null, includeRelatedFaqs = false }) {
  const language = languageFor(message, state);
  const courses = facts.filter(item => item.code && !item.kind);
  const nameWords = new Map(courses.map(item => [item.code, new Set(tokens([item.nameEn, item.nameAr].join(' ')).filter(word => word.length >= 4))]));
  const direct = courses.filter(item => [item.code, item.nameEn, item.nameAr].some(name => name && normalized(message).includes(normalized(name)))
    || [...nameWords.get(item.code)].some(word => tokens(message).includes(word) && courses.filter(other => nameWords.get(other.code).has(word)).length === 1));
  const genericAdInterest = isGenericAdInterest(message);
  const certificateQuestion = isCertificateQuestion(message, courses);
  const referralCourse = !direct.length && (genericAdInterest || (certificateQuestion && !state.selectedCourseCode))
    ? courseFromVerifiedReferral(facts, referral) : null;
  const ranked = courses.map(item => ({ item, score: score(message, [item.code, item.nameEn, item.nameAr, item.descriptionEn, item.descriptionAr, item.outcomesEn, item.outcomesAr].join(' ')) }))
    .sort((a, b) => b.score - a.score);
  const generalBusinessQuestion = /where|location|address|refund|policy|discount|اين|عنوان|موقع|استرداد|استرجاع|سياسة|خصم/i.test(message);
  let selected = direct.length ? direct.slice(0, 3) : referralCourse ? [referralCourse] : generalBusinessQuestion || genericAdInterest ? [] : ranked.filter(row => row.score >= 3).slice(0, 3).map(row => row.item);
  const followUp = /\b(?:that|this|it|its|the course|how much|how long|when does|when is|certificate|certification|online|offline|in person|face to face|classroom|remote|hybrid|delivery|study mode|course format)\b|هذه|تلك|مدتها|رسومها|موعدها|كم الرسوم|كم مدتها|متى تبدأ|شهادة|الشهادة|اعتماد|اونلاين|عن بعد|حضوري|طريقة الدراسة|طريقة التقديم/iu.test(message);
  if (!direct.length && !referralCourse && (followUp || certificateQuestion) && state.selectedCourseCode) selected = courses.filter(item => item.code === state.selectedCourseCode);
  if (!selected.length && state.selectedCourseCode) selected = courses.filter(item => item.code === state.selectedCourseCode);
  if (certificateQuestion && !direct.length && !referralCourse) selected = selected.filter(item => item.code === state.selectedCourseCode);
  const recommendation = /recommend|compare|difference|best|improve|career|beginner|توصي|تنصح|افضل|مقارن|الفرق|مبتدئ/i.test(message);
  if (!selected.length && recommendation) selected = ranked.slice(0, 3).map(row => row.item);
  const evidence = [];
  const sources = [];
  const add = (id, raw, data) => { sources.push({ id, revision: fingerprint(raw) }); evidence.push({ sourceId: id, ...data }); };
  selected.forEach(course => add('course:' + (course.courseId || course.code), course, {
    kind: 'course', code: course.code, name: local(course, 'name', language),
    description: String(local(course, 'description', language)).slice(0, 900),
    outcomes: String(local(course, 'outcomes', language)).slice(0, 250),
    difficultyLevel: course.difficultyLevel || null,
    prerequisites: String(local(course, 'prerequisites', language)).slice(0, 220),
    certificateDetails: String(course['certificateDetails' + (language === 'ar' ? 'Ar' : 'En')] || '').slice(0, 2000),
    duration: publishedDurationRange(course.descriptionEn, course.descriptionAr, language) || (course.durationValue ? `${course.durationValue} ${durationUnit(course.durationUnit, course.durationValue, language)}` : null),
    delivery: course.deliveryMode, offer: course.offer, batches: course.batches?.slice(0, 2),
  }));
  const forms = facts.filter(item => item.kind === 'published_enquiry_form');
  const formPurpose = /enquir|inquir|contact|استفسار|تواصل/i.test(message) ? 'enquiry' : 'registration';
  const selectedForm = forms.find(item => item.purpose === formPurpose) || forms[0];
  const courseInterest = selected.length === 1 && /\b(?:interested|would like to join|want to join|want to study|like to enrol|like to enroll)\b|مهتم|ارغب في التسجيل/i.test(message);
  facts.filter(item => item.kind === 'business_profile' || item === selectedForm).forEach(item => {
    if (item.kind === 'business_profile') add('business:profile', item, {
      kind: item.kind, name: local(item, 'name', language), about: String(local(item, 'about', language)).slice(0, 450),
      address: local(item, 'address', language), phone: item.phone, email: item.email,
      website: item.website, mapsUrl: item.mapsUrl, openingHours: item.openingHours,
    });
    else if (courseInterest || /enquir|inquir|enrol|enroll|register|registration|apply|join|form|sign up|تسجيل|سجل|نموذج|اشتراك/i.test(message)) add('form:enquiry', item, { kind: item.kind, purpose: item.purpose || 'enquiry', name: local(item, 'name', language), url: item.url });
  });
  const matchedFaq = findApprovedFaq(message, knowledgeEntries, language, { hasCourse: selected.length > 0 });
  const addFaq = (index, answer) => {
    const item = knowledgeEntries[index];
    add('faq:' + index, { item, profileRevision }, { kind: 'approved_faq', question: local(item, 'question', language), answer });
  };
  if (matchedFaq) addFaq(matchedFaq.index, matchedFaq.answer);
  else if (includeRelatedFaqs) {
    const terms = faqKeywords(message);
    const candidates = knowledgeEntries.map((item, index) => {
      const question = local(item, 'question', language);
      const answer = local(item, 'answer', language);
      if (!question || !answer || (selected.length && /price|fee|cost|discount|رسوم|سعر|تكلفة|خصم/i.test(question))) return null;
      const questionTerms = new Set(faqKeywords(question));
      const answerTerms = new Set(faqKeywords(answer));
      const rank = terms.reduce((sum, term) => sum + (questionTerms.has(term) ? 2 : answerTerms.has(term) ? 1 : 0), 0);
      return rank >= 2 ? { index, answer, rank } : null;
    }).filter(Boolean).sort((a, b) => b.rank - a.rank);
    for (const item of candidates.slice(0, 2)) addFaq(item.index, item.answer.slice(0, 700));
  }
  // Names are a discovery index, never evidence for unpublished prices/policies.
  if (!direct.length) add('catalogue:index', courses.map(item => ({code:item.code,nameEn:item.nameEn,nameAr:item.nameAr})), { kind: 'course_index', names: courses.slice(0, 60).map(item => local(item, 'name', language)), totalCourses: courses.length, complete: courses.length < 500 && courses.length <= 60 });
  return { evidence, sources, selectedCourseCode: selected.length === 1 ? selected[0].code : null, language, revision: fingerprint({ facts, knowledgeEntries, profileRevision }), explicitCourses: direct.length || (referralCourse ? 1 : 0), courseContextSource: direct.length ? 'message' : referralCourse ? 'meta_referral' : null };
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
  if (isCertificateQuestion(reply) && !evidence.some(item => item.kind === 'course' && item.certificateDetails)) return { valid: false, code: 'ANSWER_CERTIFICATE_UNVERIFIED' };
  if (/\b(?:i have|i've|we have|we've|you are|you're)\s+(?:booked|enrolled|registered|reserved|confirmed your)|تم (?:تسجيلك|حجز|تأكيد تسجيلك)/i.test(reply)) return { valid: false, code: 'ANSWER_COMMITMENT_INVALID' };
  return { valid: true };
}

function clarification(config, language) {
  const text = config?.guidedContent?.messages?.clarificationMessage;
  return text?.[language] || (language === 'ar' ? 'حتى أساعدك بشكل أدق، أي دورة تهمك؟ وإذا أردت التحدث مع فريقنا، اكتب موظف.' : 'Happy to help — which course are you interested in? If you’d prefer our team, just type agent.');
}

function unavailableReply(message, config, language) {
  const text = normalized(message);
  const templates = language === 'ar'
    ? [
      [/تجرب|تجريبي|مجاني|حصة مجانية/, 'لا تتوفر لدي معلومات معتمدة عن الحصص التجريبية أو المجانية حالياً. اكتب «موظف» للتواصل مع فريق القبول.'],
      [/منذ متى|تاريخ التأسيس|تأسس|تعملون منذ/, 'لا تتوفر لدي معلومات معتمدة عن تاريخ بدء المعهد حالياً. اكتب «موظف» ليؤكدها فريق القبول.'],
      [/خصم|تخفيض/, 'لا تتوفر لدي تفاصيل معتمدة عن الخصومات حالياً. اكتب «موظف» للتأكد من فريق القبول.'],
      [/مواعيد|جدول|تبدأ|دفعة/, 'لا تتوفر لدي مواعيد معتمدة لهذه الدورة حالياً. اكتب «موظف» ليتأكد فريق القبول.'],
    ]
    : [
      [/demo|trial|free class|free session/, 'I don’t have an approved demo or free-class policy saved yet. Type agent and admissions can confirm it.'],
      [/how long.*(?:operate|running)|operating|established|founded|history/, 'I don’t have the institute’s approved start date or operating history saved yet. Type agent and admissions can confirm it.'],
      [/discount|promotion/, 'I don’t have approved discount details for this enquiry. Type agent and admissions can confirm current offers.'],
      [/schedule|batch|start date|when does/, 'I don’t have a published schedule for that question yet. Type agent and admissions can confirm the current dates.'],
    ];
  const found = templates.find(([pattern]) => pattern.test(text));
  if (found) return found[1];
  const configured = config?.guidedContent?.messages?.unavailableMessage;
  return configured?.[language] || (language === 'ar' ? 'لا تتوفر لدي معلومات معتمدة عن هذا الموضوع حالياً. اكتب «موظف» للتواصل مع فريق القبول.' : 'I don’t have approved details for that yet. Type agent to reach admissions.');
}

function isCourseOverviewRequest(message, context) {
  return context.evidence.filter(item => item.kind === 'course').length === 1
    && /\bwhat about\b|\btell me (?:more|about)\b|\bmore about\b|\bmore info(?:rmation)? (?:on|about|for)\b|\bdetails? (?:on|about|for)\b|\bi(?:'|’)m interested in\b|\bi am interested in\b|\bcourse overview\b|\bwhat (?:does|will) (?:i|we|you) learn\b|\bwhat is (?:in|covered in) (?:this|the) course\b|\bwhat (?:practical )?(?:skills?|topics?|content|subjects)\b|\bsyllabus\b|\btopics\b|ماذا عن|اخبرني المزيد|أخبرني المزيد|معلومات اكثر عن|معلومات أكثر عن|مهتم(?:ة)? ب|تفاصيل (?:عن|حول)|محتوى الدورة|ماذا سنتعلم|ماذا سأتعلم|ما الذي سأتعلمه|ما المهارات|المهارات العملية|الموضوعات|المواضيع|مواضيع/i.test(message);
}

function shouldSkipApprovedFaq(message, context) {
  if (isCourseOverviewRequest(message, context)) return true;
  const courses = context.evidence.filter(item => item.kind === 'course');
  return courses.length > 1 && /\b(?:compare|comparison|difference|different|versus|vs|which|better|recommend|skills?)\b|مقارن|الفرق|الانسب|أنسب|افضل|مهارات/i.test(message);
}

function isGenericAdInterest(message) {
  return /\b(?:more info(?:rmation)?|details?)\s+(?:on|about)\s+(?:this|it)\b|\b(?:interested in)\s+(?:this|it)\b|معلومات\s*أكثر\s*عن\s*هذا|معلومات\s*اكثر\s*عن\s*هذا|تفاصيل\s*أكثر\s*عن\s*هذا|تفاصيل\s*اكثر\s*عن\s*هذا/iu.test(String(message || ''));
}

function shouldClarifyGenericCourseInterest(message, context, state = {}) {
  return isGenericAdInterest(message) && !(context?.selectedCourseCode || state?.selectedCourseCode);
}

function publishedTrainingReply(message, context) {
  const text = normalized(message);
  const ar = context.language === 'ar';
  const courses = context.evidence.filter(item => item.kind === 'course');
  const course = courses.length === 1 ? courses[0] : null;
  const business = context.evidence.find(item => item.kind === 'business_profile');
  const levels = ar
    ? { all_levels: 'جميع المستويات', beginner: 'مبتدئ', intermediate: 'متوسط', advanced: 'متقدم' }
    : { all_levels: 'All levels', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
  const fields = [
    [/\b(?:prerequisites?|entry requirements?|experience required|prior experience)\b|متطلبات|شروط الالتحاق|خبرة سابقة/u, course, course?.prerequisites, 'Prerequisites', 'المتطلبات'],
    [/\b(?:learning outcomes?|what (?:will|can) (?:i|we) learn|what (?:will|can) (?:i|we) be able to do)\b|ماذا (?:ساتعلم|سنتعلم|اتعلم)|مخرجات التعلم|نواتج التعلم/u, course, course?.outcomes, 'What you’ll learn', 'ما ستتعلمه'],
    [/\b(?:difficulty|skill level|what level|for beginners?|suitable for beginners?)\b|مستوى الدورة|للمبتدئين/u, course, levels[course?.difficultyLevel], 'Level', 'المستوى'],
    [/\b(?:opening hours|business hours|working hours|office hours|what time (?:do you|are you) open)\b|ساعات العمل|اوقات الدوام|مواعيد العمل/u, business, business?.openingHours, 'Opening hours', 'ساعات العمل'],
    [/\b(?:where are you|where is your|address|your location|google maps)\b|عنوانكم|موقعكم|اين موقع|اين المركز/u, business, [business?.address, business?.mapsUrl].filter(Boolean).join('\n'), 'Location', 'الموقع'],
    [/\b(?:your phone|contact number|phone number|whatsapp number)\b|رقم التواصل|رقم الهاتف|رقم الواتساب|رقمكم/u, business, business?.phone, 'Phone', 'الهاتف'],
    [/\b(?:your email|email address)\b|البريد الالكتروني|ايميلكم/u, business, business?.email, 'Email', 'البريد الإلكتروني'],
    [/\b(?:your website|website link|official website)\b|موقعكم الالكتروني|رابط الموقع/u, business, business?.website, 'Website', 'الموقع الإلكتروني'],
  ];
  const requested = fields.filter(([pattern]) => pattern.test(text));
  // Give compound questions to the full answer path when a listed field does not cover them.
  if (!requested.length || requested.some(([, source, value]) => !source || !String(value || '').trim())
    || /\b(?:fee|price|cost|how much|duration|how long|certificate|schedule|batch|compare|recommend|enrol|enroll|register|brochure)\b|رسوم|سعر|مدة|شهادة|دفعة|تسجيل/u.test(text)) return null;
  return {
    reply: requested.map(([, , value, en, arabic]) => `${ar ? arabic : en}: ${value}`).join('\n'),
    sourceIds: [...new Set(requested.map(([, source]) => source.sourceId))],
  };
}

function isTrainingGreeting(message) {
  return isOpeningGreeting(message) || /^(?:(?:hlo|helo|hii+|hiya|hi|hello|hey)(?: (?:sir|ma am|madam))?|sir|madam|يا استاذ)$/u.test(normalized(message));
}

function trainingGreeting({ message, state, facts, welcome }) {
  const language = languageFor(message, state);
  const ar = language === 'ar';
  const course = facts.find(item => !item.kind && item.code === state.selectedCourseCode);
  const name = course && local(course, 'name', language);
  const examples = facts.filter(item => !item.kind && item.code).map(item => local(item, 'name', language)).filter(Boolean).slice(0, 3);
  const exampleList = examples.join(ar ? '، ' : ', ');
  const nextQuestion = name
    ? (ar ? `ما الذي تود معرفته عن ${name}؟` : `What would you like to know about ${name}?`)
    : (ar ? 'هل تبحث عن دورة معينة، أم تود الاطلاع على الدورات المتاحة؟' : 'Do you have a course in mind, or would you like to see what’s available?');
  const nudges = name
    ? [nextQuestion, ar ? 'هل أساعدك في معرفة الرسوم أو مدة الدورة؟' : 'Would it help to go over the fee or how long the course takes?']
    : [exampleList ? (ar ? `من دوراتنا ${exampleList}. أي مجال يهمك؟` : `We offer courses such as ${exampleList}. What would you like to learn?`) : nextQuestion,
      ar ? 'ما المهارة التي ترغب في تعلمها؟' : 'What skill would you like to pick up?'];
  const count = Number(state.trainingGreetingNudges) || 0;
  return {
    reply: state.greeted ? nudges[count % nudges.length] : `${welcome} ${nextQuestion}`,
    state: { ...state, language, greeted: true, trainingGreetingNudges: state.greeted ? count + 1 : 0 },
  };
}

function repeatQuestion(message, context, state) {
  const [previous, answer] = (state.recentConversation || []).slice(-2);
  if (!previous || previous.role !== 'user' || answer?.role !== 'assistant'
    || context.language !== state.language || context.selectedCourseCode !== (state.selectedCourseCode || null)
    || Number(context.explicitCourses) > 1) return null;
  const topic = value => {
    const text = normalized(value);
    if (/\b(?:and|also|or|registration|installments?|discount|certificate|schedule|batch|location|compare|online|prerequisites?)\b|رسوم التسجيل|تقسيط|خصم|شهادة|جدول|دفعة|عنوان|مقارن/u.test(text)) return null;
    const duration = /\b(?:duration|how long|how much time)\b|مدة|مدتها/u.test(text);
    const fee = /\b(?:fee|fees|price|cost|how much(?! time))\b|رسوم|سعر|تكلفة/u.test(text);
    return fee === duration ? null : fee ? 'fee' : 'duration';
  };
  const requested = topic(message);
  if (requested && requested === topic(previous.text) && context.selectedCourseCode) return { topic: requested, previousReply: answer.text };
  if (normalized(message) === normalized(previous.text)) return { previousReply: answer.text };
  return null;
}

function repeatedCourseFact(repeat, context) {
  if (!repeat?.topic) return null;
  const course = context.evidence.find(item => item.kind === 'course' && item.code === context.selectedCourseCode);
  if (!course) return null;
  const ar = context.language === 'ar';
  const offer = course.offer;
  const fee = offer?.priceAmount != null && offer.currency ? `${offer.priceAmount} ${offer.currency}` : null;
  const registration = Number(offer?.registrationFeeAmount) > 0
    ? (ar ? ` رسوم التسجيل ${offer.registrationFeeAmount} ${offer.currency}.` : ` The registration fee is ${offer.registrationFeeAmount} ${offer.currency}.`)
    : '';
  let choices;
  if (repeat.topic === 'fee' && fee) {
    choices = ar ? [`رسوم الدورة ${fee}.`, `تكلفة الدراسة ${fee}.`] : [`The course fee is ${fee}.`, `Tuition for ${course.name} is ${fee}.`];
    choices = choices.map(text => text + registration);
  } else if (repeat.topic === 'duration' && course.duration) {
    choices = ar ? [`تستغرق الدورة ${course.duration}.`, `مدة الدراسة ${course.duration}.`]
      : [`It runs for ${course.duration}.`, `${course.name} takes ${course.duration} to complete.`];
  } else return null;
  return { reply: choices.find(text => normalized(text) !== normalized(repeat.previousReply)) || choices[0], sourceIds: [course.sourceId] };
}

function certificateFollowUp(message, context, state) {
  if (!state.pendingCertificateQuestion || !context.selectedCourseCode || Number(context.explicitCourses) !== 1) return false;
  const course = context.evidence.find(item => item.kind === 'course' && item.code === context.selectedCourseCode);
  return Boolean(course && ([course.code, course.name].some(value => value && normalized(value) === normalized(message))
    || isBareCourseSelection(message, context)));
}

function courseCertificateReply(message, context) {
  const ar = context.language === 'ar';
  const course = context.evidence.find(item => item.kind === 'course' && item.code === context.selectedCourseCode);
  if (!course) return { route: 'clarification', sourceIds: [], reply: ar
    ? 'أي دورة تقصد؟ تختلف تفاصيل الشهادات والتصديق من دورة لأخرى.'
    : 'Which course are you considering? Certificate and attestation details vary by course.' };
  const details = String(course.certificateDetails || '').trim();
  if (!details) return { route: 'clarification', sourceIds: [course.sourceId], reason: 'CERTIFICATE_DETAILS_UNVERIFIED', reply: ar
    ? `ليست لدي تفاصيل مؤكدة عن شهادة دورة ${course.name} حاليًا. يمكن لفريق القبول التحقق منها لك.`
    : `Admissions can check this for you. I don’t have confirmed certificate details for ${course.name} yet.` };

  // Publish the saved wording verbatim. A certificate or a named issuer alone
  // does not establish attestation by the authority the customer asked about.
  const text = normalized(message), saved = normalized(details);
  const attestation = /\b(?:attestation|attest(?:ed|s)?|accreditation|accredited|legalized|legalised)\b|تصديق|مصدق|اعتماد|معتمد/u;
  const authority = /\b(?:ministry|ministries|mofa|moehe|government|chamber)\b|وزار|حكوم|غرف/u;
  const asksAuthority = authority.test(text);
  const needsCheck = asksAuthority || (attestation.test(text) && !attestation.test(saved));
  const note = needsCheck ? (ar
    ? '\n\nيمكن لفريق القبول التحقق مما إذا كانت الشهادة تستوفي التصديق أو الاعتماد الذي تحتاجه.'
    : '\n\nAdmissions can confirm whether this meets the attestation or accreditation you need.') : '';
  return { route: 'facts', sourceIds: [course.sourceId], reply: `${course.name}\n${details}${note}` };
}

function simpleFactualReply(message, context, config = {}) {
  const text = normalized(message), ar = context.language === 'ar';
  const courses = context.evidence.filter(item => item.kind === 'course');
  if (courses.length !== 1 || /\b(?:compare|recommend|difference|best|better|cheaper)\b|مقارن|افضل|الفرق|تنصح/.test(text)) return null;
  const course = courses[0];
  const asksDuration = /how long|duration|مدة|مدتها/i.test(message);
  if (isCertificateQuestion(message, courses)) return course.certificateDetails ? courseCertificateReply(message, context) : null;
  const asksDelivery = /\b(?:online|offline|in person|face to face|classroom|remote|hybrid|delivery|availability|available online)\b|عن بعد|اونلاين|حضوري|مدمج|طريقة الدراسة|طريقة التقديم/u.test(message);
  if (asksDelivery && course.delivery) {
    const mode = String(course.delivery).toLowerCase();
    const deliveryLabels = ar
      ? { online: 'عن بُعد', in_person: 'حضوري', hybrid: 'مدمج يجمع بين الدراسة عن بُعد والحضور' }
      : { online: 'online', in_person: 'in person', hybrid: 'hybrid, combining online and in-person learning' };
    const label = deliveryLabels[mode] || mode.replace(/_/g, ' ');
    const reply = ar
      ? `تُدرج المعلومات المنشورة دورة ${course.name} بنمط ${label}. لا تتوفر لدي تفاصيل الجلسات، ويمكن لفريق القبول تأكيدها لك.`
      : `${course.name} is listed as ${label}. I don’t have a published breakdown of the sessions; admissions can confirm the details.`;
    return { reply, sourceIds: [course.sourceId] };
  }
  const asksFee = /\b(?:fee|fees|price|cost|how much)\b|رسوم|سعر|تكلفة/i.test(message);
  const registrationForm = context.evidence.find(item => item.kind === 'published_enquiry_form' && item.purpose === 'registration');
  const courseInterest = /\b(?:interested|would like to join|want to join|want to study|like to enrol|like to enroll)\b|مهتم|ارغب في التسجيل/i.test(message);
  const applicationOffer = courseInterest && registrationForm
    ? config.guidedContent?.messages?.applicationOfferMessage?.[ar ? 'ar' : 'en'] || (ar ? 'إذا رغبت، يمكنني إرسال نموذج التسجيل لك.' : 'If you’d like, I can send you the registration form.')
    : '';
  if (asksDuration && asksFee) {
    const feeTemplate = config.guidedContent?.messages?.simpleFeeMessage?.[ar ? 'ar' : 'en'] || (ar ? 'رسوم {course} حالياً {fee}.{registration}' : '{course} is currently {fee}.{registration}');
    const durationTemplate = config.guidedContent?.messages?.durationUnavailable?.[ar ? 'ar' : 'en'] || (ar ? 'مدة {course} غير منشورة حالياً. يمكن لفريقنا تأكيدها لك.' : 'The duration for {course} isn’t published yet. Our team can confirm it for you.');
    const fee = course.offer?.priceAmount != null && course.offer?.currency
      ? feeTemplate.replaceAll('{course}', course.name).replaceAll('{fee}', `${course.offer.priceAmount} ${course.offer.currency}`).replaceAll('{registration}', Number(course.offer.registrationFeeAmount) > 0 ? ` ${config.guidedContent?.messages?.registrationFeeLabel?.[ar ? 'ar' : 'en'] || (ar ? 'رسوم التسجيل' : 'Registration fee')}: ${course.offer.registrationFeeAmount} ${course.offer.currency}.` : '')
      : (config.guidedContent?.messages?.feeUnavailable?.[ar ? 'ar' : 'en'] || (ar ? 'رسوم الدورة غير منشورة.' : 'The fee for this course isn’t published yet.'));
    const duration = course.duration
      ? (config.guidedContent?.messages?.simpleDurationMessage?.[ar ? 'ar' : 'en'] || (ar ? 'مدة {course} هي {duration}.' : '{course} takes {duration}.')).replaceAll('{course}', course.name).replaceAll('{duration}', course.duration)
      : durationTemplate.replaceAll('{course}', course.name);
    return { reply: [fee, duration, applicationOffer].filter(Boolean).join(' '), sourceIds: [course.sourceId, ...(applicationOffer ? [registrationForm.sourceId] : [])], nextStep: applicationOffer ? 'course_detail' : null };
  }
  if (asksDuration) {
    if (!course.duration && /\d+\s*(?:[–-]\s*\d+)?\s*(?:weeks?|days?|hours?|months?|أسابيع|اسابيع|أسبوع|اسبوع|ساعات|شهور|أشهر|ايام|أيام)/iu.test(course.description || '')) return null;
    const key = course.duration ? 'simpleDurationMessage' : 'durationUnavailable';
    const fallback = course.duration ? (ar ? 'مدة {course} هي {duration}.' : '{course} takes {duration}.') : (ar ? 'مدة {course} غير منشورة حالياً. يمكن لفريقنا تأكيدها لك.' : 'The duration for {course} isn’t published yet. Our team can confirm it for you.');
    const template = config.guidedContent?.messages?.[key]?.[ar ? 'ar' : 'en'] || fallback;
    return { reply: template.replaceAll('{course}', course.name).replaceAll('{duration}', course.duration || ''), sourceIds: [course.sourceId] };
  }
  if (asksFee) {
    if (!course.offer?.priceAmount) return null;
    const fee = `${course.offer.priceAmount} ${course.offer.currency}`;
    const label = config.guidedContent?.messages?.registrationFeeLabel?.[ar ? 'ar' : 'en'] || (ar ? 'رسوم التسجيل' : 'Registration fee');
    const extra = Number(course.offer.registrationFeeAmount) > 0 ? ` ${label}: ${course.offer.registrationFeeAmount} ${course.offer.currency}.` : '';
    const template = config.guidedContent?.messages?.simpleFeeMessage?.[ar ? 'ar' : 'en'] || (ar ? 'رسوم {course} حالياً {fee}.{registration}' : '{course} is currently {fee}.{registration}');
    return { reply: template.replaceAll('{course}', course.name).replaceAll('{fee}', fee).replaceAll('{registration}', extra), sourceIds: [course.sourceId] };
  }
  if (isCourseOverviewRequest(message, context)) {
    const description = String(course.description || '').replace(/\s+/g, ' ').trim();
    const overviewMatch = String(course.description || '').split(/[\r\n]+/).map(line => line.trim()).filter(Boolean)
      .map(line => line.match(/^✅?\s*\*{0,2}([^:*]{2,45})\*{0,2}\s*:\s*(.+)$/u)).filter(Boolean);
    const overviewDetails = overviewMatch.slice(0, 6).map(([, label, detail]) => {
      const cleanLabel = label.trim(), cleanDetail = detail.replace(/\*+/g, '').trim();
      return ar ? COURSE_TOPIC_AR.get(normalized(cleanLabel)) || `${cleanLabel}: ${cleanDetail}` : `${cleanLabel}: ${cleanDetail}`;
    });
    const levelMatch = String(course.description || '').match(/\b(beginner\s+to\s+intermediate|beginner|intermediate|advanced)\b/i);
    const levelEn = levelMatch?.[1] || ({ all_levels: 'all levels', beginner: 'beginner', intermediate: 'intermediate', advanced: 'advanced' }[course.difficultyLevel] || '');
    const levelAr = levelMatch ? ({ 'beginner to intermediate': 'المبتدئين إلى المستوى المتوسط', beginner: 'المبتدئين', intermediate: 'المستوى المتوسط', advanced: 'المستوى المتقدم' }[levelMatch[1].toLowerCase()] || '')
      : ({ all_levels: 'جميع المستويات', beginner: 'المبتدئين', intermediate: 'المستوى المتوسط', advanced: 'المستوى المتقدم' }[course.difficultyLevel] || '');
    const boundary = description.search(/[.!؟](?=\s|$)/u);
    const summary = boundary >= 45 && boundary <= 320
      ? description.slice(0, boundary + 1)
      : description.length > 320
        ? description.slice(0, 317).replace(/\s+\S*$/, '') + '…'
        : description;
    if (!summary) return null;
    if (overviewDetails.length && /topic|cover|learn|skill|محتو|موضوع|مهار|تغط|تتعلم/i.test(message)) {
      const topics = overviewDetails.join('; ');
      const level = /beginner|level|مبتد|مستوى|خبرة/i.test(message) && levelEn
        ? (ar ? ` يذكر وصف الدورة أنها مناسبة لمتعلمين من ${levelAr || levelEn}.` : ` The description says the level is ${levelEn}.`)
        : '';
      const duration = course.duration ? (ar ? ` المدة ${course.duration}.` : ` Duration: ${course.duration}.`) : '';
      const fee = course.offer?.priceAmount != null && course.offer?.currency
        ? (ar ? ` الرسوم ${course.offer.priceAmount} ${course.offer.currency}.` : ` Fee: ${course.offer.priceAmount} ${course.offer.currency}.`)
        : '';
      const reply = ar
        ? `تشمل موضوعات الدورة: ${topics}.${level}${duration}${fee}`
        : `Course topics include: ${topics}.${level}${duration}${fee}`;
      return { reply, sourceIds: [course.sourceId] };
    }
    const fee = course.offer?.priceAmount != null && course.offer?.currency
      ? (ar ? `الرسوم الحالية ${course.offer.priceAmount} ${course.offer.currency}.` : `The current fee is ${course.offer.priceAmount} ${course.offer.currency}.`)
      : '';
    const prompt = applicationOffer || config.guidedContent?.messages?.courseDetailsPrompt?.[ar ? 'ar' : 'en']
      || (ar ? 'هل تود معرفة شيء آخر عن هذه الدورة؟' : 'Would you like to know anything else about this course?');
    return { reply: [`${course.name}: ${summary}`, fee, prompt].filter(Boolean).join(' '), sourceIds: [course.sourceId, ...(applicationOffer ? [registrationForm.sourceId] : [])] };
  }
  return null;
}

function previewState(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 4000) throw Object.assign(new Error('INVALID_PREVIEW_STATE'), { code: 'INVALID_PREVIEW_STATE' });
  const result = {};
  for (const key of ['step', 'language', 'selectedCourseCode']) if (typeof value[key] === 'string' && value[key].length <= 80) result[key] = value[key];
  if (typeof value.pendingCertificateQuestion === 'string' && value.pendingCertificateQuestion.length <= 240 && isCertificateQuestion(value.pendingCertificateQuestion)) {
    result.pendingCertificateQuestion = value.pendingCertificateQuestion;
  }
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

function polishGuidedReply({ result, profile, message, state, defaults }) {
  if (profile.engine !== 'guided' && isOpeningGreeting(message)) {
    const language = languageFor(message, result.state || state || {});
    const greeting = profile.config?.guidedContent?.messages?.greeting?.[language] || defaults.messages.greeting[language];
    const configured = profile.config?.guidedContent?.messages?.menuPrompt?.[language] || defaults.messages.menuPrompt?.[language];
    const legacyNumericPrompt = /\b(?:reply|type|send)\b.{0,35}\b(?:number|option|[0-3])\b|\b[0-3]\s*(?:for|to)\b|أرسل\s*رقم|ارسل\s*رقم|الخيار\s*رقم/iu.test(configured || '');
    const followUp = legacyNumericPrompt || !configured
      ? (language === 'ar' ? 'ما الدورة التي تهمك، وما الذي ترغب في معرفته عنها؟' : 'Which course are you interested in, and what would you like to know about it?')
      : configured;
    result.reply = `${greeting}\n\n${followUp}`;
  }
  return result;
}

module.exports = { normalized, fingerprint, languageFor, controlRoute, isScheduleQuestion, hasPublishedSchedule, courseDetailNeedsCoordinator, trainingCenterCoordinatorReason, publishedDurationRange, retrieveContext, validateAnswer, clarification, unavailableReply, publishedTrainingReply, simpleFactualReply, isCourseOverviewRequest, shouldSkipApprovedFaq, isGenericAdInterest, shouldClarifyGenericCourseInterest, isBareCourseSelection, previewState, redactCustomerText, polishGuidedReply, qrAdReferral, courseFromVerifiedReferral, isTrainingGreeting, trainingGreeting, repeatQuestion, repeatedCourseFact, isCertificateQuestion, courseCertificateReply, certificateFollowUp };
