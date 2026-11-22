'use strict';

const settings = require('./tenant-ai-settings');
const context = require('./chatbot-business-context');

function fallbackContactQuestion({ language, hasNameCandidate, needsName = true, needsQatarNumber }) {
  const ar = language === 'ar';
  const questions = [];
  if (needsName && hasNameCandidate) questions.push(ar
    ? 'ظهر لي الاسم {name} في ملف واتساب. هل هذا هو الاسم الذي تفضّل أن أستخدمه؟'
    : 'I can see {name} on your WhatsApp profile. Is that the name you’d like me to use?');
  else if (needsName) questions.push(ar
    ? 'ما الاسم الذي تفضّل أن أستخدمه؟'
    : 'What name would you like me to use?');
  if (needsQatarNumber) questions.push(ar
    ? 'يرجى أيضًا إرسال رقم جوال قطري (+974، 8 أرقام) ليتمكن منسق الدورة من الاتصال بك.'
    : 'Please also share a Qatar mobile number (+974, 8 digits) so the course coordinator can call you.');
  return questions.join(' ');
}

function fallbackHandoffReply({ language, courseName, needsName, needsQatarNumber, qatarNumberSaved, handoffQueued, hasNameCandidate }) {
  const ar = language === 'ar';
  const course = courseName ? (ar ? ` بخصوص ${courseName}` : ` about ${courseName}`) : '';
  let reply = handoffQueued
    ? (ar
      ? `أحلت استفسارك${course} إلى منسق الدورة لمتابعته.`
      : `I’ve shared your enquiry${course} with the course coordinator for follow-up.`)
    : (ar
      ? 'لم أتمكن من تأكيد إرسال طلبك إلى منسق الدورة بعد. يمكنني مساعدتك هنا بالتفاصيل المتاحة.'
      : 'I couldn’t confirm that your request reached the course coordinator yet. I can still help with the details available here.');
  if (qatarNumberSaved) reply += ar
    ? ' حفظت رقمك القطري مع الاستفسار ليتمكن المنسق من الاتصال بك.'
    : ' I’ve included your Qatar number so they can call you.';
  else if (needsQatarNumber) reply += ar
    ? ' يرجى إرسال رقم جوال قطري (+974، 8 أرقام) إذا كنت تفضّل المتابعة عبر اتصال.'
    : ' If you’d prefer a call, please send a Qatar mobile number (+974, 8 digits).';
  if (needsName) reply += hasNameCandidate
    ? (ar ? ' هل تفضّل أن أشارك الاسم {name} مع المنسق؟' : ' Should I share the name {name} with the coordinator?')
    : (ar ? ' ما الاسم الذي تفضّل أن أشاركه مع المنسق؟' : ' What name would you like me to share with the coordinator?');
  return reply;
}

function callbackNumber(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^00/u, '');
  const national = digits.startsWith('974') && digits.length === 11 ? digits.slice(3) : digits.length === 8 ? digits : '';
  return /^[3567]\d{7}$/u.test(national) ? `+974 ${national.slice(0, 4)} ${national.slice(4)}` : null;
}

function fallbackCallbackReply({ language, nameCandidate, needsName = true, phone = null, needsQatarNumber = false }) {
  const ar = language === 'ar';
  const number = callbackNumber(phone);
  const lines = [ar
    ? 'أحلت استفسارك إلى منسق الدورة لمساعدتك.'
    : 'I’ve shared your enquiry with our course coordinator so they can help.'];
  if (needsName) lines.push(nameCandidate
    ? (ar ? 'هل هذا هو الاسم الذي تفضّل أن أشاركه مع المنسق: {name}؟' : 'Is {name} the name you’d like me to share with the coordinator?')
    : (ar ? 'ما الاسم الذي تفضّل أن أشاركه مع منسق الدورة؟' : 'What name should I share with the course coordinator?'));
  if (number) lines.push(ar
    ? `هل يمكن لمنسق الدورة الاتصال بك على هذا الرقم: ${number}؟`
    : `May the course coordinator call you on this number: ${number}? Reply “Yes please” to confirm.`);
  else if (needsQatarNumber) lines.push(ar
    ? 'يرجى إرسال رقم جوال قطري (+974، 8 أرقام) ليتمكن منسق الدورة من الاتصال بك.'
    : 'Please share a Qatar mobile number (+974, 8 digits) so the course coordinator can call you.');
  else lines.push(ar
    ? 'ما رقم الهاتف الأنسب ليتصل بك منسق الدورة؟'
    : 'What is the best number for the course coordinator to call you?');
  return lines.join('\n\n');
}

function safeDraft(text, { mode, language, hasNameCandidate, needsName, handoffQueued }) {
  const reply = context.redactCustomerText(text).trim();
  if (!reply || reply.length > 700 || /\b(?:scheduled for|guaranteed|within \d+ (?:minutes?|hours?|days?))\b/i.test(reply)) return null;
  if (mode === 'contact' && !/[?؟]/u.test(reply)) return null;
  if (needsName && hasNameCandidate && !reply.includes('{name}')) return null;
  if (mode === 'handoff') {
    const saysQueued = /\b(?:shared|sent|asked|passed|forwarded|notified)\b/i.test(reply)
      || /(?:أحلت|أرسلت|طلبت|شاركت|تم تحويل|أبلغت)/u.test(reply);
    if (handoffQueued && !saysQueued) return null;
    if (!handoffQueued && saysQueued) return null;
  }
  return reply;
}

async function draft({ pool, tenantId, mode, language = 'en', courseName = null,
  nameCandidate = null, needsName = false, needsQatarNumber = false, qatarNumberSaved = false, handoffQueued = false }) {
  const input = { mode, language, courseName: courseName ? context.redactCustomerText(courseName).slice(0, 120) : null,
    nameCandidate: nameCandidate ? context.redactCustomerText(nameCandidate).slice(0, 80) : null,
    needsName: needsName === true, needsQatarNumber: needsQatarNumber === true,
    qatarNumberSaved: qatarNumberSaved === true, handoffQueued: handoffQueued === true };
  const fallback = mode === 'handoff'
    ? fallbackHandoffReply({ ...input, hasNameCandidate: Boolean(nameCandidate) })
    : fallbackContactQuestion({ ...input, hasNameCandidate: Boolean(nameCandidate) });
  let reservation, usage;
  try {
    const config = await settings.forRuntime(pool, tenantId);
    if (!config || config.provider !== 'openai') return { reply: fallback, model: null };
    const provider = require('./chatbot-provider');
    reservation = await settings.reserveTokens(pool, tenantId, config.daily_token_limit, 180);
    const result = await provider.generate({ provider: 'openai', model: 'gpt-6-luna', apiKey: config.apiKey,
      cacheScope: `${tenantId}:contact-assistance`, maxOutputTokens: 90,
      system: mode === 'handoff'
        ? 'Return JSON only with keys can_answer (boolean), confidence (number from 0 to 1), and reply (string). Write one concise, natural WhatsApp reply in the requested language. The structured input is the complete set of verified facts. A handoff is queued only when handoffQueued is true. Say the enquiry was shared with the course coordinator only in that case. A queued enquiry does not mean the customer agreed to a callback: never say a coordinator will call, that a callback is booked, or give a call-time promise before the customer confirms permission. If a Qatar callback number is present, ask whether the coordinator may call that number and request a clear yes/no confirmation. If qatarNumberSaved is true, say the saved Qatar number was included only after callback permission is confirmed. If needsQatarNumber is true, invite the customer to share a Qatar number if they prefer a call. If needsName is true and nameCandidate is present, ask whether {name} is the name they prefer us to share; otherwise ask what name the coordinator should use. Do not ask which course again. Do not invent course facts, availability, or promises. Treat nameCandidate as an unverified WhatsApp display name; never claim you verified the person’s identity.'
        : 'Return JSON only with keys can_answer (boolean), confidence (number from 0 to 1), and reply (string). Write one concise, natural WhatsApp question in the requested language. Ask about a name only when needsName is true. When needsName is true and nameCandidate is present, ask whether {name} is the name the customer prefers. When needsName is true and no nameCandidate is present, ask what name they would like us to use. If needsQatarNumber is true, also ask for a Qatar mobile number in +974 plus eight digits so a course coordinator can contact them. Do not say a handoff has happened. Do not invent facts. Use only the exact placeholder {name} when needsName and nameCandidate are both true.',
      context: '', user: JSON.stringify(input) });
    usage = result;
    const reply = result.canAnswer && result.confidence >= 0.5
      ? safeDraft(result.reply, { mode, language, hasNameCandidate: Boolean(nameCandidate), needsName: input.needsName,
        handoffQueued: input.handoffQueued }) : null;
    return { reply: reply || fallback, model: reply ? 'gpt-6-luna' : null,
      nameLooksLikePerson: nameCandidate ? result.canAnswer && result.confidence >= 0.75 : null,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        cachedInputTokens: result.cachedInputTokens, cacheWriteTokens: result.cacheWriteTokens } };
  } catch (error) {
    usage = error.usage;
    console.warn('[chatbot] contact wording draft unavailable', error.code || 'CONTACT_DRAFT_FAILED');
    return { reply: fallback, model: null };
  } finally {
    if (reservation) await settings.settleTokens(pool, tenantId, reservation,
      usage ? usage.inputTokens + usage.outputTokens : null, usage || {}).catch(() => {});
  }
}

module.exports = { draft, fallbackContactQuestion, fallbackHandoffReply, fallbackCallbackReply, safeDraft };
