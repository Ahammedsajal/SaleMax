'use strict';

const contextRules = require('./chatbot-business-context');

const textLimit = 3500;
const broadInterest = /\b(?:more (?:info(?:rmation)?|details?)|tell me (?:about|more)|details? (?:on|about|for)|interested in|course overview|what about|would like to (?:know|join))\b|معلومات|تفاصيل|مهتم|اخبرني عن|أخبرني عن|اريد معرفة|أريد معرفة/u;
const focused = /\b(?:how much|fees?|price|cost|duration|how long|when|start date|schedule|timings?|batch|requirements?|certificate|attestation|location|address|syllabus|topics|what (?:will|do) i learn|compare|versus|registration form)\b|رسوم|سعر|تكلفة|مدة|متى|موعد|جدول|دفعة|متطلبات|شهادة|تصديق|عنوان|موقع|منهج|محاور|مقارن|نموذج التسجيل/u;
const controlledClaims = /\b(?:qar|riyals?|registration fees?|tuition|course fees?|accredited|accreditation|attest\w*|ofqual|internationally recogni[sz]ed|certificates? upon completion|next (?:batch|intake)|start date)\b|رسوم|ريال|تصديق|معتمدة|معتمد|موعد البدء/u;

function isOpeningRequest(message, context, course) {
  if (!course || !context.selectedCourseCode || Number(context.explicitCourses) !== 1) return false;
  if (context.courseContextSource === 'meta_referral' && contextRules.isGenericAdInterest(message)) return true;
  let text = ' ' + contextRules.normalized(message) + ' ';
  for (const name of [course.nameEn, course.nameAr, course.code]) {
    if (name) text = text.replaceAll(' ' + contextRules.normalized(name) + ' ', ' ');
  }
  return !text.trim() || (!focused.test(text) && (broadInterest.test(text) || contextRules.isBareCourseSelection(message, context)));
}

function cleanCopy(value) {
  // Prices, certification and intakes have their own authoritative fields.
  return String(value || '').split(/\r?\n/u).map(line => line.split(/(?<=[.!?؟])\s+/u)
    .filter(sentence => !controlledClaims.test(contextRules.normalized(sentence))).join(' ').trim()).filter(Boolean).join('\n');
}

function chunks(text) {
  const parts = [];
  let remaining = text.trim();
  while (remaining.length > textLimit) {
    const range = remaining.slice(0, textLimit + 1);
    const boundary = Math.max(range.lastIndexOf('\n'), range.lastIndexOf(' '));
    const cut = boundary > textLimit / 2 ? boundary : textLimit;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function planOpening({ facts, message, context, state = {}, config = {}, firstMatch = false }) {
  const code = context.selectedCourseCode;
  const course = facts.find(item => !item.kind && item.code === code);
  if (!course || state.courseOpeningCodes?.includes(code) || (!firstMatch && !isOpeningRequest(message, context, course))) return null;
  const evidence = context.evidence.find(item => item.kind === 'course' && item.code === code);
  if (!evidence) return null;
  const ar = context.language === 'ar';
  const label = (en, arabic) => ar ? arabic : en;
  const localCopy = key => cleanCopy(course[key + (ar ? 'Ar' : 'En')] || course[key + (ar ? 'En' : 'Ar')]);
  const field = (title, value) => value ? '*' + title + '*\n' + value : null;
  const levels = {
    all_levels: label('All levels', 'جميع المستويات'), beginner: label('Beginner', 'مبتدئ'),
    intermediate: label('Intermediate', 'متوسط'), advanced: label('Advanced', 'متقدم'),
  };
  const delivery = {
    in_person: label('In person', 'حضوري'), online: label('Online', 'عن بُعد'), hybrid: label('Hybrid', 'مدمج'),
  }[evidence.delivery];
  const overview = [
    '*' + evidence.name + '*', localCopy('description'),
    field(label('What you’ll learn', 'ما ستتعلمه'), localCopy('outcomes')),
    field(label('Entry requirements', 'متطلبات الالتحاق'), localCopy('prerequisites')),
    levels[evidence.difficultyLevel] && label('Level', 'المستوى') + ': ' + levels[evidence.difficultyLevel],
  ].filter(Boolean).join('\n\n');
  const display = config.guidedContent?.display || {};
  const offer = evidence.offer || {};
  const amount = value => offer.currency && value != null && Number.isFinite(Number(value))
    ? offer.currency + ' ' + Number(value).toLocaleString(ar ? 'ar-QA' : 'en-QA', { maximumFractionDigits: 2 }) : null;
  const fee = display.showFees !== false && amount(offer.priceAmount);
  const registration = fee && display.showRegistrationFee !== false && amount(offer.registrationFeeAmount);
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null;
  const starts = [...new Set((evidence.batches || []).map(batch => date(batch.startsOn)).filter(Boolean))];
  const business = context.evidence.find(item => item.kind === 'business_profile');
  const details = [
    '*' + label('Course details', 'تفاصيل الدورة') + '*',
    evidence.duration && label('Duration', 'المدة') + ': ' + evidence.duration,
    delivery && label('Delivery', 'طريقة الدراسة') + ': ' + delivery,
    fee && label('Course fee', 'رسوم الدورة') + ': ' + fee,
    registration && (Number(offer.registrationFeeAmount) === 0 ? label('No registration fee', 'لا توجد رسوم تسجيل')
      : label('Registration fee', 'رسوم التسجيل') + ': ' + registration),
    evidence.delivery !== 'online' && business?.address && label('Training centre', 'مركز التدريب') + ': ' + business.address,
    display.showUpcomingBatches !== false && (starts.length
      ? label('Upcoming start dates', 'مواعيد البدء القادمة') + ': ' + starts.join(label(', ', '، '))
      : label('Admissions can confirm the next start date.', 'يمكن لفريق القبول تأكيد موعد البدء القادم.')),
    field(label('Certification', 'الشهادة'), evidence.certificateDetails),
    facts.some(item => item.kind === 'published_enquiry_form' && item.purpose === 'registration')
      && label('I can share the registration form when you’re ready.', 'يمكنني إرسال نموذج التسجيل عندما تكون مستعدًا.'),
  ].filter(Boolean).join('\n');
  const files = course.media || [];
  const pdf = files.find(item => item.kind === 'document' && item.mimeType === 'application/pdf' && !state.sentCoursePdfIds?.includes(item.id));
  const attachment = pdf || files.find(item => item.kind === 'image');
  const texts = [...chunks(overview), ...chunks(details)];
  return {
    reply: texts[0], openingTexts: texts.slice(1),
    media: attachment ? [{ ...attachment, courseId: course.courseId }] : [],
    route: 'course-opening',
    state: { ...state, greeted: true, language: context.language, selectedCourseCode: code, waitingForCourse: false, step: 'course_detail',
      courseOpeningCodes: [...(state.courseOpeningCodes || []), code].slice(-20) },
  };
}

module.exports = { planOpening, isOpeningRequest, textLimit };
