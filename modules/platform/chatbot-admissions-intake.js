'use strict';

const choices = {
  asap: { en: 'as soon as possible', ar: 'في أقرب وقت ممكن' },
  within_month: { en: 'within a month', ar: 'خلال شهر' },
  one_to_three_months: { en: 'in one to three months', ar: 'خلال شهر إلى ثلاثة أشهر' },
  later: { en: 'later', ar: 'لاحقا' },
  flexible: { en: 'a flexible start date', ar: 'موعد بداية مرن' },
};
const immediateStart = /^(?:asap|as soon as possible|immediately|right away|فوراً?|فورًا|في أقرب وقت(?: ممكن)?)[.!،\s]*$/iu;

function enabled(tenantId) {
  return Boolean(tenantId && tenantId === process.env.SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID);
}

function acknowledgement(text, language) {
  const value = String(text || '').normalize('NFKC').trim().replace(/[.!،…]+$/u, '').trim();
  if (/^(?:ok|okay|alright|got it|understood|تمام|طيب|حسنا|حسنًا|👍[\uFE0F\p{Emoji_Modifier}]*)$/iu.test(value)) {
    return language === 'ar' ? 'تمام.' : 'Got it.';
  }
  if (/^(?:thanks|thank you|many thanks|شكرا|شكرًا|شكراً|يعطيك العافية)$/iu.test(value)) {
    return language === 'ar' ? 'على الرحب والسعة.' : 'You’re welcome.';
  }
  return null;
}

function startPreference(text, waiting = false) {
  const raw = String(text || '').trim();
  if (!raw || /[?؟]/u.test(raw)) return null;
  const explicit = raw.match(/(?:\b(?:i\s+(?:can|need to|want to|plan to|would like to|prefer to)\s+start|my preferred start(?: date)? is|start date:)\s*|(?:أريد أن أبدأ|اريد ان ابدا|أقدر أبدأ|يمكنني أن أبدأ|موعد البدء المفضل)\s*)([^.!؟،\n]+)/iu);
  if (!waiting && !explicit) return null;
  const value = (explicit?.[1] || raw).trim().replace(/[.!،]+$/u, '');
  if (value.length > 64 || !/^[\p{L}\p{M}\p{N} /-]+$/u.test(value)) return null;
  const only = [
    [immediateStart, 'asap'],
    [/^(?:today|tomorrow|اليوم|غدا|غداً)$/iu, 'asap'],
    [/^(?:(?:in |within )?(?:a|one|1) month|this month|(?:this|next) week|خلال شهر|هذا الشهر|هذا (?:الأسبوع|الاسبوع)|الأسبوع القادم|الاسبوع القادم)$/iu, 'within_month'],
    [/^(?:next month|(?:in |within )?(?:one to three|1 to 3|1-3|two|three|2|3) months|الشهر القادم|بعد شهرين|بعد ثلاثة أشهر)$/iu, 'one_to_three_months'],
    [/^(?:later|later this year|لاحقا|لاحقاً|في وقت لاحق)$/iu, 'later'],
    [/^(?:flexible|a flexible start date|anytime|any time|not sure|no preference|مرن|أي وقت|اي وقت|غير محدد|لست متأكدا|لست متأكداً)$/iu, 'flexible'],
  ];
  const window = only.find(([pattern]) => pattern.test(value.replace(/^(?:on|from) /iu, '')))?.[1] || null;
  const answerOnly = !explicit || (explicit.index === 0 && explicit[0].length === raw.replace(/[.!،]+$/u, '').length);
  if (window) return { window, detail: value, only: answerOnly };
  const dateLike = /^(?:(?:on|from|in|by|في|من) )?(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:\p{Nd}{1,2} )?(?:january|february|march|april|may|june|july|august|september|october|november|december|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)(?: \p{Nd}{1,4})?|(?:this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)(?: القادم)?)$/iu;
  return dateLike.test(value) ? { window: null, detail: value, only: answerOnly } : null;
}

function advance({ prior, text, name, nameOnly, savedName, savedStart, language, recognizeImmediate = false }) {
  const state = { ...prior };
  const waiting = prior.waiting;
  const start = startPreference(text, waiting === 'start' || waiting === 'confirmStart' || (recognizeImmediate && immediateStart.test(text)));
  const yes = /^(?:yes|correct|that's right|that is right|نعم|صحيح|أجل|اي|أيوه)[.!\s]*$/iu.test(text);
  const no = /^(?:no|incorrect|not anymore|لا|غير صحيح)[.!\s]*$/iu.test(text);
  const confirming = waiting === 'confirmName' || waiting === 'confirmStart';
  const answerOnly = Boolean(nameOnly || start?.only || (confirming && (yes || no)));
  if ((name && !start?.only) || (waiting === 'confirmName' && yes)) state.nameConfirmed = true;
  if (start || (waiting === 'confirmStart' && yes)) state.startConfirmed = true;
  if (waiting === 'confirmName' && no) state.replaceName = true;
  if (waiting === 'confirmStart' && no) state.replaceStart = true;
  if (answerOnly) state.waiting = null;

  const ar = language === 'ar';
  const candidates = [];
  if (!state.nameConfirmed) {
    if (savedName && !state.replaceName) candidates.push(['confirmName', ar
      ? `لديّ اسمك مسجلاً باسم ${savedName}، هل يمكنك تأكيد أنني سجلته بشكل صحيح؟`
      : `I have your name as ${savedName}—could you please confirm I’ve got it right?`]);
    else candidates.push(['name', ar ? 'ما الاسم الذي تفضّل أن أستخدمه عند مخاطبتك؟' : 'May I ask what name you’d like me to use?']);
  }
  if (!state.startConfirmed) {
    if (savedStart && !state.replaceStart) candidates.push(['confirmStart', ar
      ? `ذكرت أن موعد البدء المفضل لديك هو ${savedStart}—هل أُبقي ذلك مسجلاً؟`
      : `You mentioned ${savedStart} as your preferred start—would you like me to keep that noted?`]);
    else candidates.push(['start', ar ? 'متى تود أن تبدأ؟ لا بأس إن لم يكن لديك موعد محدد بعد.' : 'When would you ideally like to begin? If you’re flexible, that’s completely fine.']);
  }
  const [key, prompt] = candidates.find(([field]) => Number(state[field + 'Asked'] || 0) < 2) || [];
  return { state, key, prompt, answerOnly, start };
}

function savedStartLabel(qualification, language) {
  return startPreference(qualification.preferredStartDetail, true)?.detail
    || choices[qualification.preferredStartWindow]?.[language] || null;
}

function courseInterest(text) {
  const match = String(text).match(/^(?:i (?:want|would like) to know about|tell me about|(?:i am|i'm) interested in|اريد معلومات عن|أريد معلومات عن|اخبرني عن|أخبرني عن)\s+([^.!?؟،\n]+)/iu);
  const course = match?.[1].trim();
  return course && course.length <= 100 && /\bcourse\b|\btraining\b|دورة|تدريب/iu.test(course) && /^[\p{L}\p{M}\p{N} &/-]+$/u.test(course) ? course : null;
}

const deferredReasons = new Set(['SCHEDULE_REQUIRES_COORDINATOR', 'COURSE_DETAIL_REQUIRES_COORDINATOR',
  'AI_PROVIDER_NOT_CONFIGURED', 'AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_REQUEST_FAILED', 'AI_PROVIDER_INVALID_OUTPUT']);

function planReply(answer, info) {
  const { session, key } = info.intake;
  const prior = session.admissionsEscalation;
  const reason = deferredReasons.has(answer.code)
    ? answer.code : prior?.courseInterest === info.courseInterest ? prior?.reason : null;
  if (!reason) return answer;
  if (answer.handedOff && !deferredReasons.has(answer.code)) return answer;
  if (!key) return { handedOff: true, code: reason };
  const state = { ...(answer.state || session), admissionsEscalation: { reason, courseInterest: info.courseInterest } };
  if (!answer.handedOff) return { ...answer, state };
  const ar = info.language === 'ar';
  const reply = reason === 'SCHEDULE_REQUIRES_COORDINATOR'
    ? (ar ? 'ليست لدي مواعيد مؤكدة لهذه الدورة حاليا.' : 'I don’t have a confirmed start date for that course yet.')
    : (ar ? 'يمكن لفريق القبول التأكد من هذه التفاصيل.' : 'Admissions can check those details for you.');
  return { canAnswer: true, reply, state, route: 'admissions-intake', reason };
}

module.exports = { planReply, enabled, acknowledgement, startPreference, savedStartLabel, advance, courseInterest };
