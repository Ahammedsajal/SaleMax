'use strict';

const { keywordReply } = require('./chatbot-keyword-replies');

function clean(value, max = 240) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/u, '').trimEnd() + '…';
}

function normalizeDigits(value) {
  return String(value || '').replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function mergeDefaults(defaults, value) {
  if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, mergeDefaults(fallback, source[key])]));
  }
  return typeof value === typeof defaults ? value : defaults;
}

function copy(settings, key, language, fallback = '') {
  const value = settings.messages?.[key];
  const selected = typeof value === 'string' ? value : value?.[language] || value?.[language === 'ar' ? 'en' : 'ar'];
  return typeof selected === 'string' ? selected.trim() : fallback;
}

function languageFor(message, state, config) {
  if (/^(?:english|en)$/i.test(String(message || '').trim())) return 'en';
  if (/^(?:arabic|ar|العربية|عربي)$/i.test(String(message || '').trim())) return 'ar';
  if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(String(message || ''))) return 'ar';
  if (state?.language === 'ar' || state?.language === 'en') return state.language;
  return config?.language === 'ar' ? 'ar' : 'en';
}

function menuText(facts = [], settings = {}, language = 'en', { includeGreeting = true } = {}) {
  const defaults = require('./chatbot-domain-packs').getDomainPack('training_center', 1).guidedContentDefaults || {};
  settings = mergeDefaults(defaults, settings);
  const form = facts.find(item => item?.kind === 'published_enquiry_form' && typeof item.url === 'string');
  const lines = [];
  if (includeGreeting) lines.push(copy(settings, 'greeting', language, language === 'ar' ? 'أهلاً بك!' : 'Welcome!'));
  lines.push(`[1] *${copy(settings, 'coursesLabel', language, language === 'ar' ? 'عرض الدورات' : 'View courses')}*`);
  if (form && settings.display?.showEnquiryForm !== false) {
    const label = form.purpose === 'registration' ? copy(settings, 'applicationLabel', language) : copy(settings, 'enquiryLabel', language);
    lines.push(`[2] ${label}`);
  }
  lines.push(`[3] ${copy(settings, 'admissionsLabel', language)}` + ` · [0] ${copy(settings, 'mainMenuLabel', language, 'Menu')}`);
  lines[lines.length - 1] += ` · ${copy(settings, 'menuPrompt', language)}`;
  return lines.join('\n');
}

function courseLimit(settings) {
  const value = Number(settings.display?.maxCourses);
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(9, value)) : 9;
}

const DURATION_UNITS = Object.freeze({
  hours: { en: ['hour', 'hours'], ar: ['ساعة', 'ساعتان', 'ساعات'] },
  days: { en: ['day', 'days'], ar: ['يوم', 'يومان', 'أيام'] },
  weeks: { en: ['week', 'weeks'], ar: ['أسبوع', 'أسبوعان', 'أسابيع'] },
  months: { en: ['month', 'months'], ar: ['شهر', 'شهران', 'أشهر'] },
});
const DELIVERY_MODES = Object.freeze({
  in_person: { en: 'In person', ar: 'حضوري' },
  online: { en: 'Online', ar: 'عن بُعد' },
  hybrid: { en: 'Hybrid', ar: 'مدمج' },
});

function localizedDurationUnit(value, amount, language) {
  const unit = clean(value, 40).toLowerCase();
  const choices = DURATION_UNITS[unit];
  if (!choices) return unit.replace(/_/g, ' ');
  const quantity = Number(amount);
  if (language !== 'ar') return choices.en[quantity === 1 ? 0 : 1];
  return choices.ar[quantity === 1 ? 0 : quantity === 2 ? 1 : 2];
}

function localizedDeliveryMode(value, language) {
  const mode = clean(value, 80).toLowerCase();
  return DELIVERY_MODES[mode]?.[language] || mode.replace(/_/g, ' ');
}

function localizedBatchLanguage(value, language) {
  const code = clean(value, 20).replace(/_/g, '-');
  if (!code) return '';
  try { return new Intl.DisplayNames([language === 'ar' ? 'ar-QA' : 'en'], { type: 'language' }).of(code) || code; }
  catch { return code; }
}

function localizedBatchDate(value, language) {
  const date = clean(value, 24);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-QA' : 'en-QA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  } catch { return date; }
}

function formatCourseList(courses, settings = {}, language = 'en', page = 0) {
  const start = Math.max(0, page) * 2;
  const visible = courses.slice(0, courseLimit(settings)).slice(start, start + 2);
  if (!visible.length) {
    return copy(settings, 'courseListEmpty', language, language === 'ar' ? 'لا توجد دورات منشورة متاحة حالياً. أرسل 0 للقائمة الرئيسية.' : 'There are no published courses available right now. Reply 0 for the main menu.');
  }
  const lines = [`*${copy(settings, 'courseListHeading', language, language === 'ar' ? 'الدورات المتاحة' : 'Available courses')}*`];
  visible.forEach((course, index) => {
    const name = clean(language === 'ar' ? (course.nameAr || course.nameEn || course.code) : (course.nameEn || course.nameAr || course.code), 100);
    let line = `${start + index + 1}. ${name}`;
    if (settings.display?.showFees !== false && course.offer?.priceAmount != null && course.offer?.currency) line += ` — ${course.offer.priceAmount} ${course.offer.currency}`;
    lines.push(line);
  });
  lines.push(copy(settings, 'courseListPrompt', language));
  return lines.join('\n');
}

function formatCourseDetails(course, formUrl, settings = {}, language = 'en', applicationAvailable = false) {
  const name = clean(language === 'ar' ? (course.nameAr || course.nameEn || course.code) : (course.nameEn || course.nameAr || course.code), 120);
  const description = clean(language === 'ar' ? (course.descriptionAr || course.descriptionEn) : (course.descriptionEn || course.descriptionAr), 110).replace(/\s+/g, ' ');
  const lines = [`*${name}*`];
  if (description && settings.display?.showDescription !== false) lines.push(description);
  if (settings.display?.showDuration !== false && course.durationValue && course.durationUnit) {
    lines.push(`${copy(settings, 'durationLabel', language, language === 'ar' ? 'المدة' : 'Duration')}: ${clean(String(course.durationValue), 24)} ${localizedDurationUnit(course.durationUnit, course.durationValue, language)}`);
  }
  if (settings.display?.showDelivery !== false && course.deliveryMode) lines.push(`${copy(settings, 'deliveryLabel', language, language === 'ar' ? 'طريقة الدراسة' : 'Delivery')}: ${localizedDeliveryMode(course.deliveryMode, language)}`);
  if (settings.display?.showFees !== false) {
    if (course.offer?.priceAmount != null && course.offer?.currency) {
      lines.push(`${copy(settings, 'currentFeeLabel', language, language === 'ar' ? 'الرسوم الحالية' : 'Current fee')}: ${course.offer.priceAmount} ${course.offer.currency}`);
    } else {
      lines.push(copy(settings, 'feeUnavailable', language, language === 'ar' ? 'رسوم الدورة غير منشورة.' : 'Fee details are not published.'));
    }
    if (settings.display?.showRegistrationFee !== false && course.offer?.registrationFeeAmount != null && course.offer?.currency) {
      lines.push(`${copy(settings, 'registrationFeeLabel', language, language === 'ar' ? 'رسوم التسجيل' : 'Registration fee')}: ${course.offer.registrationFeeAmount} ${course.offer.currency}`);
    }
  }
  const batchIndex = lines.length;
  if (settings.display?.showUpcomingBatches !== false) {
    const batches = Array.isArray(course.batches) ? course.batches : [];
    if (batches.length) {
      lines.push(copy(settings, 'batchesHeading', language, language === 'ar' ? 'المجموعات القادمة' : 'Upcoming batches'));
      for (const batch of batches.slice(0, 1)) {
        const date = localizedBatchDate(batch.startsOn, language);
        const batchLanguage = localizedBatchLanguage(batch.language, language);
        const seats = Math.max(0, Number(batch.seatsAvailable) || 0);
        lines.push(language === 'ar'
          ? `${date}${batchLanguage ? ` · ${batchLanguage}` : ''} · ${copy(settings, 'batchSeatsLabel', language, 'المقاعد المتاحة')}: ${seats}`
          : `${date}${batchLanguage ? ` · ${batchLanguage}` : ''} · ${seats} ${copy(settings, 'batchSeatsLabel', language, 'seats available')}`);
      }
    } else lines.push(copy(settings, 'noUpcomingBatches', language));
  }
  const batchLine = lines.splice(batchIndex).join(' · ');
  const heading = lines.shift();
  const summary = description && settings.display?.showDescription !== false ? lines.shift() : null;
  const factsLine = lines.join(' · ');
  const followUp = copy(settings, 'courseDetailsPrompt', language);
  const applicationOffer = applicationAvailable ? copy(settings, 'applicationOfferMessage', language) : '';
  const prompt = (batchLine ? batchLine + ' · ' : '') + [followUp, applicationOffer].filter(Boolean).join(' ');
  return [heading, summary, factsLine, prompt].filter(Boolean).join('\n');
}

function trainingCenterGuidedReplyTurn({ message, state, facts, config, defaults }) {
  const text = normalizeDigits(clean(message, 2000)).toLowerCase();
  const courses = facts.filter(item => item && typeof item.code === 'string' && item.code.length <= 80);
  const settings = mergeDefaults(defaults || {}, config || {});
  const language = languageFor(message, state, config);
  const form = facts.find(item => item?.kind === 'published_enquiry_form');
  const registrationFormUrl = form?.purpose === 'registration' ? form.url : null;
  const showForm = settings.display?.showEnquiryForm !== false;
  const formUrl = showForm && typeof form?.url === 'string' ? form.url : null;
  const step = state?.step;
  const nextState = (nextStep, extra = {}) => ({ ...extra, step: nextStep, language });

  if (step === 'course_detail' && registrationFormUrl && /^(?:yes[,.! ]*(?:please|send it|send me|share it)?|sure|please do|send it|send me|share it|i'm interested|im interested|اي|نعم|نعم من فضلك|أرسلها|ارسلها|أرسل النموذج|ارسل النموذج)$/iu.test(text)) {
    return { reply: `${copy(settings, 'applicationLinkIntro', language)}\n${registrationFormUrl}`, state: nextState('application_shared', { ...(state || {}) }) };
  }

  if (step === 'course_list' && /^(next|previous|prev|التالي|السابق)$/.test(text)) {
    const listed = (state.courseCodes || []).map(code => courses.find(course => course.code === code)).filter(Boolean);
    const direction = /^(next|التالي)$/.test(text) ? 1 : -1;
    const page = Math.max(0, Math.min((state.page || 0) + direction, Math.max(0, Math.ceil(listed.length / 2) - 1)));
    return { reply: formatCourseList(listed, settings, language, page), state: nextState('course_list', { courseCodes: listed.map(course => course.code), page }) };
  }
  if ((text === '3' && step !== 'course_list') || /\b(?:human|person|someone|agent|staff|advisor|representative)\b|موظف|شخص|مستشار|خدمة العملاء|فريق القبول/i.test(text)) {
    return { reply: copy(settings, 'handoffMessage', language, language === 'ar' ? 'تم إيقاف الردود الآلية مؤقتاً ليتمكن فريق العمل من مساعدتك.' : 'I have paused the automated replies so the team can help you.'), state: nextState(step || 'menu', state || {}), handoff: true };
  }
  if (/^(?:0|menu|back|main menu|english|en|arabic|ar|العربية|عربي|القائمة|القائمة الرئيسية|رجوع)$/i.test(text)) {
    return { reply: menuText(facts, settings, language, { includeGreeting: false }), state: nextState('menu') };
  }
  if (/^(?:2|form|enquiry form|registration form|نموذج|نموذج الاستفسار)$/i.test(text) && (step !== 'course_list' || text !== '2')) {
    return { reply: formUrl
      ? `*${copy(settings, 'enquiryPrompt', language, language === 'ar' ? 'نموذج الاستفسار' : 'Enquiry form')}*\n${formUrl}`
      : copy(settings, 'enquiryUnavailable', language, language === 'ar' ? 'لم يتم نشر نموذج استفسار بعد.' : 'An enquiry form is not published yet.'),
    state: nextState('menu') };
  }
  const customReply = /^\d+$/.test(text) ? null : keywordReply(message, config?.keywordReplies, language);
  if (customReply) return { reply: customReply, state: { ...(state || {}), language, step: step || 'menu' }, customReply: true };
  const namedCourse = courses.find(course => [course.nameEn, course.nameAr, course.code].some(name => {
    const normalized = clean(name, 100).toLowerCase();
    return normalized.length >= 3 && text.includes(normalized);
  }));
  if (namedCourse && !/^\d+$/.test(text)) return { reply: formatCourseDetails(namedCourse, formUrl, settings, language, !!registrationFormUrl), state: nextState('course_detail', { courseCodes: courses.slice(0, courseLimit(settings)).map(course => course.code), selectedCourseCode: namedCourse.code }) };
  const keywords = text.split(/[\s?!،؟.,]+/u).filter(word => word.length >= 3 && !/^(?:what|which|how|much|the|for|about|tell|please|want|would|like|know|course|courses|training|fee|fees|price|cost|details|information|هل|اريد|أريد|دورة|الدورة|رسوم|تفاصيل|سعر|كم)$/iu.test(word));
  const matches = keywords.length && !/^\d+$/.test(text) ? courses.filter(course => {
    const names = [course.nameEn, course.nameAr, course.code].join(' ').toLowerCase();
    return keywords.every(word => names.includes(word));
  }) : [];
  if (matches.length === 1) return { reply: formatCourseDetails(matches[0], formUrl, settings, language, !!registrationFormUrl), state: nextState('course_detail', { courseCodes: courses.slice(0, courseLimit(settings)).map(course => course.code), selectedCourseCode: matches[0].code }) };
  if (matches.length > 1) return { reply: formatCourseList(matches, settings, language), state: nextState('course_list', { courseCodes: matches.slice(0, courseLimit(settings)).map(course => course.code) }) };
  if (step === 'course_detail') {
    if (/^(?:1|courses?|course list|another|other course|الدورات|عرض الدورات|دورة أخرى)$/i.test(text)) {
      const visible = courses.slice(0, courseLimit(settings));
      return { reply: formatCourseList(visible, settings, language), state: nextState('course_list', { courseCodes: visible.map(course => course.code) }) };
    }
    const course = courses.find(item => item.code === state.selectedCourseCode);
    if (!course) return { reply: formatCourseList(courses, settings, language), state: nextState('course_list', { courseCodes: courses.slice(0, courseLimit(settings)).map(item => item.code) }) };
    return { reply: formatCourseDetails(course, formUrl, settings, language, !!registrationFormUrl), state: nextState('course_detail', { courseCodes: state.courseCodes || [], selectedCourseCode: course.code }) };
  }
  const browseCourses = (step !== 'course_list' && text === '1')
    || /^(?:courses?|course list|course details|fees?|prices?|cost|schedule|batches|training|enrol|enroll|register|admission|الدورات|عرض الدورات|دورة|رسوم|السعر|جدول|مواعيد|التسجيل|القبول)$/i.test(text)
    || /\b(?:courses?|fees?|prices?|costs?|schedule|batches?|classes?|training|enrol|enroll|register|admission)\b|الدورات|دورة|رسوم|السعر|جدول|مواعيد|التسجيل|القبول/i.test(text);
  if (browseCourses || (step === 'course_list' && /^\d+$/.test(text) && Number(text) < 1)) {
    const visible = courses.slice(0, courseLimit(settings));
    return { reply: formatCourseList(visible, settings, language), state: nextState('course_list', { courseCodes: visible.map(course => course.code) }) };
  }
  if (step === 'course_list' && /^\d+$/.test(text)) {
    const index = Number(text) - 1;
    const code = Array.isArray(state.courseCodes) ? state.courseCodes[index] : null;
    const course = courses.find(item => item.code === code);
    if (course) return { reply: formatCourseDetails(course, formUrl, settings, language, !!registrationFormUrl), state: nextState('course_detail', { courseCodes: state.courseCodes.slice(0, courseLimit(settings)), selectedCourseCode: course.code }) };
    return { reply: `${copy(settings, 'invalidSelection', language)} ${formatCourseList(courses, settings, language)}`, state: nextState('course_list', { courseCodes: courses.slice(0, courseLimit(settings)).map(course => course.code) }) };
  }
  if (step === 'course_list') return { reply: formatCourseList(courses, settings, language), state: nextState('course_list', { courseCodes: courses.slice(0, courseLimit(settings)).map(course => course.code) }) };

  const greeting = /^(?:hi|hello|hey|good morning|good afternoon|good evening|مرحبا|أهلا|السلام عليكم|صباح الخير|مساء الخير)$/i.test(text);
  if (!step || greeting) return { reply: menuText(facts, settings, language, { includeGreeting: !state?.greeted }), state: nextState('menu') };
  const fallback = copy(settings, 'fallbackMessage', language, language === 'ar' ? 'أعتذر، لم أفهم الاختيار.' : 'I did not understand that selection.');
  return { reply: `${fallback}\n${menuText(facts, settings, language, { includeGreeting: false })}`, state: nextState('menu') };
}

function trainingCenterGuidedReply({ message, state, facts, config, defaults }) {
  const result = trainingCenterGuidedReplyTurn({ message, state, facts, config, defaults });
  const settings = mergeDefaults(defaults || {}, config || {});
  const language = languageFor(message, state, config);
  const greeting = copy(settings, 'greeting', language, language === 'ar' ? 'أهلاً بك!' : 'Welcome!');
  if (!state?.greeted && !result.handoff && !result.reply.startsWith(greeting)) {
    result.reply = `${greeting} ${result.reply}`;
  }
  if (!state?.greeted && !result.handoff && !result.reply.includes('[1]')) result.reply += `\n\n${menuText(facts, settings, language, { includeGreeting: false })}`;
  result.state = { ...(result.state || {}), greeted: true };
  const selected = facts.find(course => course.code === result.state.selectedCourseCode);
  if (!result.handoff && !result.customReply && result.state.step === 'course_detail' && selected && (state?.selectedCourseCode !== selected.code || /brochure|catalog(?:ue)?|pdf|photo|image|بروشور|كتالوج|صورة/i.test(message))) {
    const files = Array.isArray(selected.media) ? selected.media : [];
    result.media = ['image', 'document'].map(kind => files.find(file => file.kind === kind)).filter(Boolean)
      .map(file => ({ ...file, courseId: selected.courseId }));
  }
  return result;
}

function shouldStartGuided(message) {
  const text = normalizeDigits(clean(message, 2000));
  return /^(?:0|1|2|menu|back|main menu|courses?|course list|course details|fees?|prices?|schedule|batches|form|enquiry form|registration form|hi|hello|hey|good morning|good afternoon|good evening|yes|yes please|sure|please do|send it|send me|share it|i'm interested|im interested|اي|نعم|نعم من فضلك|أرسلها|ارسلها|أرسل النموذج|ارسل النموذج|مرحبا|أهلا|السلام عليكم|صباح الخير|مساء الخير|القائمة|القائمة الرئيسية|رجوع|الدورات|عرض الدورات|دورة|رسوم|السعر|جدول|مواعيد|التسجيل|القبول|نموذج|نموذج الاستفسار)$/i.test(text)
    || /^(?:send|reply|reply with|type|أرسل|ارسل|اكتب)\s*[0-9]+$/i.test(text)
    || /\b(?:courses?|fees?|prices?|costs?|schedule|batches?|classes?|training|enrol|enroll|register|registration|admission|form|enquiry|human|person|agent|staff|advisor|representative)\b|الدورات|دورة|رسوم|السعر|جدول|مواعيد|التسجيل|القبول|نموذج|استفسار|موظف|شخص|مستشار|خدمة العملاء/i.test(text);
}

module.exports = { trainingCenterGuidedReply, shouldStartGuided, menuText, formatCourseList, formatCourseDetails, normalizeDigits };
