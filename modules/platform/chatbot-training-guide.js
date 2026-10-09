'use strict';

function clean(value, max = 240) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '';
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
  if (typeof value === 'string') return clean(value, 1000) || fallback;
  if (!value || typeof value !== 'object') return fallback;
  return clean(value[language], 1000) || clean(value[language === 'ar' ? 'en' : 'ar'], 1000) || fallback;
}

function languageFor(message, state, config) {
  if (/^(?:english|en)$/i.test(String(message || '').trim())) return 'en';
  if (/^(?:arabic|ar|العربية|عربي)$/i.test(String(message || '').trim())) return 'ar';
  if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(String(message || ''))) return 'ar';
  if (state?.language === 'ar' || state?.language === 'en') return state.language;
  return config?.language === 'ar' ? 'ar' : 'en';
}

function menuText(facts = [], settings = {}, language = 'en', { includeGreeting = true } = {}) {
  const form = facts.find(item => item?.kind === 'published_enquiry_form' && typeof item.url === 'string');
  const lines = [];
  if (includeGreeting) lines.push(copy(settings, 'greeting', language, language === 'ar' ? 'أهلاً بك!' : 'Welcome!'));
  lines.push(`1. ${copy(settings, 'coursesLabel', language, language === 'ar' ? 'عرض الدورات' : 'View courses')}`);
  if (form && settings.display?.showEnquiryForm !== false) {
    lines.push(`2. ${copy(settings, 'enquiryLabel', language, language === 'ar' ? 'نموذج الاستفسار' : 'Enquiry form')}`);
  }
  lines.push(`0. ${copy(settings, 'mainMenuLabel', language, language === 'ar' ? 'القائمة الرئيسية' : 'Main menu')}`);
  lines.push(language === 'ar' ? '3. التحدث مع فريق القبول' : '3. Speak to admissions');
  lines.push(copy(settings, 'menuPrompt', language, language === 'ar' ? 'اختر خياراً أو أرسل agent لمساعدة الموظفين.' : 'Choose an option or type agent for staff help.'));
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

function formatCourseList(courses, settings = {}, language = 'en') {
  const visible = courses.slice(0, courseLimit(settings));
  if (!visible.length) {
    return copy(settings, 'courseListEmpty', language, language === 'ar' ? 'لا توجد دورات منشورة متاحة حالياً. أرسل 0 للقائمة الرئيسية.' : 'There are no published courses available right now. Reply 0 for the main menu.');
  }
  const lines = [copy(settings, 'courseListHeading', language, language === 'ar' ? 'الدورات المتاحة' : 'Available courses')];
  visible.forEach((course, index) => {
    const name = clean(language === 'ar' ? (course.nameAr || course.nameEn || course.code) : (course.nameEn || course.nameAr || course.code), 100);
    let line = `${index + 1}. ${name}`;
    if (settings.display?.showFees !== false && course.offer?.priceAmount != null && course.offer?.currency) line += ` — ${course.offer.priceAmount} ${course.offer.currency}`;
    lines.push(line);
  });
  lines.push(copy(settings, 'courseListPrompt', language, language === 'ar' ? 'أرسل رقم الدورة للتفاصيل أو 0 للقائمة الرئيسية.' : 'Reply with a course number for details, or 0 for the main menu.'));
  return lines.join('\n');
}

function formatCourseDetails(course, formUrl, settings = {}, language = 'en') {
  const name = clean(language === 'ar' ? (course.nameAr || course.nameEn || course.code) : (course.nameEn || course.nameAr || course.code), 120);
  const description = clean(language === 'ar' ? (course.descriptionAr || course.descriptionEn) : (course.descriptionEn || course.descriptionAr), 600);
  const lines = [name];
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
  if (settings.display?.showUpcomingBatches !== false) {
    const batches = Array.isArray(course.batches) ? course.batches : [];
    if (batches.length) {
      lines.push(copy(settings, 'batchesHeading', language, language === 'ar' ? 'المجموعات القادمة' : 'Upcoming batches'));
      for (const batch of batches.slice(0, 4)) {
        const date = localizedBatchDate(batch.startsOn, language);
        const batchLanguage = localizedBatchLanguage(batch.language, language);
        const seats = Math.max(0, Number(batch.seatsAvailable) || 0);
        lines.push(language === 'ar'
          ? `${date}${batchLanguage ? ` · ${batchLanguage}` : ''} · ${copy(settings, 'batchSeatsLabel', language, 'المقاعد المتاحة')}: ${seats}`
          : `${date}${batchLanguage ? ` · ${batchLanguage}` : ''} · ${seats} ${copy(settings, 'batchSeatsLabel', language, 'seats available')}`);
      }
    } else {
      lines.push(copy(settings, 'noUpcomingBatches', language, language === 'ar' ? 'لم تُنشر مواعيد مجموعات قادمة.' : 'No upcoming batch dates are published.'));
    }
  }
  if (formUrl && settings.display?.showEnquiryForm !== false) {
    lines.push(`${copy(settings, 'enquiryLabel', language, language === 'ar' ? 'نموذج الاستفسار' : 'Enquiry form')}: ${formUrl}`);
  }
  lines.push(copy(settings, 'courseDetailsPrompt', language, language === 'ar' ? 'أرسل 1 لاستعراض الدورات أو 0 للقائمة الرئيسية.' : 'Reply 1 to browse courses or 0 for the main menu.'));
  return lines.join('\n').slice(0, 1800);
}

function trainingCenterGuidedReplyTurn({ message, state, facts, config, defaults }) {
  const text = normalizeDigits(clean(message, 2000)).toLowerCase();
  const courses = facts.filter(item => item && typeof item.code === 'string' && item.code.length <= 80);
  const settings = mergeDefaults(defaults || {}, config || {});
  const language = languageFor(message, state, config);
  const form = facts.find(item => item?.kind === 'published_enquiry_form');
  const showForm = settings.display?.showEnquiryForm !== false;
  const formUrl = showForm && typeof form?.url === 'string' ? form.url : null;
  const step = state?.step;
  const nextState = (nextStep, extra = {}) => ({ step: nextStep, language, ...extra });

  if ((text === '3' && step !== 'course_list') || /\b(?:human|person|someone|agent|staff|advisor|representative)\b|موظف|شخص|مستشار|خدمة العملاء|فريق القبول/i.test(text)) {
    return { reply: copy(settings, 'handoffMessage', language, language === 'ar' ? 'تم إيقاف الردود الآلية مؤقتاً ليتمكن فريق العمل من مساعدتك.' : 'I have paused the automated replies so the team can help you.'), state: nextState(step || 'menu', state || {}), handoff: true };
  }
  if (/^(?:0|menu|back|main menu|english|en|arabic|ar|العربية|عربي|القائمة|القائمة الرئيسية|رجوع)$/i.test(text)) {
    return { reply: menuText(facts, settings, language, { includeGreeting: false }), state: nextState('menu') };
  }
  if (/^(?:2|form|enquiry form|registration form|نموذج|نموذج الاستفسار)$/i.test(text) && (step !== 'course_list' || text !== '2')) {
    return { reply: formUrl
      ? `${copy(settings, 'enquiryPrompt', language, language === 'ar' ? 'استخدم نموذج الاستفسار المنشور للتواصل مع المركز:' : 'Use the published enquiry form to contact the center:')} ${formUrl}`
      : copy(settings, 'enquiryUnavailable', language, language === 'ar' ? 'لم يتم نشر نموذج استفسار بعد.' : 'An enquiry form is not published yet.'),
    state: nextState('menu') };
  }
  const namedCourse = courses.find(course => [course.nameEn, course.nameAr, course.code].some(name => {
    const normalized = clean(name, 100).toLowerCase();
    return normalized.length >= 3 && text.includes(normalized);
  }));
  if (namedCourse && !/^\d+$/.test(text)) return { reply: formatCourseDetails(namedCourse, formUrl, settings, language), state: nextState('course_detail', { courseCodes: courses.slice(0, courseLimit(settings)).map(course => course.code), selectedCourseCode: namedCourse.code }) };
  if (step === 'course_detail') {
    if (/^(?:1|courses?|course list|another|other course|الدورات|عرض الدورات|دورة أخرى)$/i.test(text)) {
      const visible = courses.slice(0, courseLimit(settings));
      return { reply: formatCourseList(visible, settings, language), state: nextState('course_list', { courseCodes: visible.map(course => course.code) }) };
    }
    const course = courses.find(item => item.code === state.selectedCourseCode);
    if (!course) return { reply: formatCourseList(courses, settings, language), state: nextState('course_list', { courseCodes: courses.slice(0, courseLimit(settings)).map(item => item.code) }) };
    return { reply: formatCourseDetails(course, formUrl, settings, language), state: nextState('course_detail', { courseCodes: state.courseCodes || [], selectedCourseCode: course.code }) };
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
    if (course) return { reply: formatCourseDetails(course, formUrl, settings, language), state: nextState('course_detail', { courseCodes: state.courseCodes.slice(0, courseLimit(settings)), selectedCourseCode: course.code }) };
    return { reply: `${copy(settings, 'invalidSelection', language, language === 'ar' ? 'هذا الاختيار غير متاح.' : 'That selection is not available.')}\n\n${formatCourseList(courses, settings, language)}`, state: nextState('course_list', { courseCodes: courses.slice(0, courseLimit(settings)).map(course => course.code) }) };
  }
  if (step === 'course_list') return { reply: `${copy(settings, 'courseListPrompt', language, language === 'ar' ? 'أرسل رقم الدورة أو 0 للقائمة الرئيسية.' : 'Reply with a course number or 0 for the main menu.')}\n\n${formatCourseList(courses, settings, language)}`, state: nextState('course_list', { courseCodes: courses.slice(0, courseLimit(settings)).map(course => course.code) }) };

  const greeting = /^(?:hi|hello|hey|good morning|good afternoon|good evening|مرحبا|أهلا|السلام عليكم|صباح الخير|مساء الخير)$/i.test(text);
  if (!step || greeting) return { reply: menuText(facts, settings, language, { includeGreeting: !state?.greeted }), state: nextState('menu') };
  const fallback = copy(settings, 'fallbackMessage', language, language === 'ar' ? 'أعتذر، لم أفهم الاختيار.' : 'I did not understand that selection.');
  return { reply: `${fallback}\n\n${menuText(facts, settings, language, { includeGreeting: false })}`, state: nextState('menu') };
}

function trainingCenterGuidedReply({ message, state, facts, config, defaults }) {
  const result = trainingCenterGuidedReplyTurn({ message, state, facts, config, defaults });
  const settings = mergeDefaults(defaults || {}, config || {});
  const language = languageFor(message, state, config);
  const greeting = copy(settings, 'greeting', language, language === 'ar' ? 'أهلاً بك!' : 'Welcome!');
  if (!state?.greeted && !result.handoff && !result.reply.startsWith(greeting)) {
    result.reply = `${greeting}\n\n${result.reply}`;
  }
  result.state = { ...(result.state || {}), greeted: true };
  return result;
}

function shouldStartGuided(message) {
  const text = normalizeDigits(clean(message, 2000));
  return /^(?:0|1|2|menu|back|main menu|courses?|course list|course details|fees?|prices?|schedule|batches|form|enquiry form|registration form|hi|hello|hey|good morning|good afternoon|good evening|مرحبا|أهلا|السلام عليكم|صباح الخير|مساء الخير|القائمة|القائمة الرئيسية|رجوع|الدورات|عرض الدورات|دورة|رسوم|السعر|جدول|مواعيد|التسجيل|القبول|نموذج|نموذج الاستفسار)$/i.test(text)
    || /^(?:send|reply|reply with|type|أرسل|ارسل|اكتب)\s*[0-9]+$/i.test(text)
    || /\b(?:courses?|fees?|prices?|costs?|schedule|batches?|classes?|training|enrol|enroll|register|registration|admission|form|enquiry|human|person|agent|staff|advisor|representative)\b|الدورات|دورة|رسوم|السعر|جدول|مواعيد|التسجيل|القبول|نموذج|استفسار|موظف|شخص|مستشار|خدمة العملاء/i.test(text);
}

module.exports = { trainingCenterGuidedReply, shouldStartGuided, menuText, formatCourseList, formatCourseDetails, normalizeDigits };
