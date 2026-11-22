'use strict';
const crypto = require('node:crypto');
const context = require('./chatbot-business-context');
const admissions = require('./chatbot-admissions-intake');
const { recipientAllowed } = require('./chatbot-audience');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value || {};
const normalizedDigits = value => require('./chatbot-training-guide').normalizeDigits(value);

function qatarMobile(value) {
  const digits = normalizedDigits(value).replace(/\D/g, '').replace(/^00/, '');
  const national = digits.startsWith('974') && digits.length === 11 ? digits.slice(3) : digits.length === 8 ? digits : '';
  return /^[3567]\d{7}$/.test(national) ? `+974${national}` : null;
}

function qatarMobileFromText(value) {
  const text = normalizedDigits(value);
  const matches = text.match(/(?<!\d)(?:\+|00)?[\s().-]*(?:974[\s().-]*)?[3567](?:[\s().-]*\d){7}(?!\d)/gu) || [];
  for (const match of matches) {
    const number = qatarMobile(match);
    if (number) return number;
  }
  return null;
}

function phoneOnly(value) {
  const text = normalizedDigits(value).trim();
  return text.length > 0 && /^\+?[\d\s().-]+$/.test(text) && text.replace(/\D/g, '').length >= 7;
}

function qatarCallbackEnabled(ctx) {
  // This callback-number policy is currently owner-approved for Pro Catalyst.
  return ctx?.tenant?.slug === 'pro-catalyst-05f1f2b34f';
}

function affirmativeReply(value) {
  const text = context.normalized(value).replace(/[,.!?؟،]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return /^(?:yes|yes please|yes thats right|thats right|correct|right|yes they can|please do|please call|sure|of course|that is fine|thats fine|نعم|نعم من فضلك|نعم تفضل|بالتأكيد|أكيد|يمكنهم الاتصال|هذا صحيح|صحيح)$/iu.test(text);
}

function nameConfirmationReply(value) {
  const text = context.normalized(value).replace(/\b(that|this)\s+s\b/gu, '$1 is');
  return /^(?:(?:yes|yeah|yep|correct|right)\s+)?(?:(?:that|this)\s+is\s+)?(?:my|the)\s+name(?:\s+is)?$/iu.test(text);
}

function callbackConsentReply(value) {
  const text = context.normalized(value).replace(/\b(that|this)\s+s\b/gu, '$1 is');
  // A name confirmation is not permission to call, even when it starts with "yes".
  if (/\b(?:my|the)\s+name\b|اسم/iu.test(text)) return false;
  return affirmativeReply(value)
    || /^(?:(?:yes|yeah|yep)\s+)?(?:(?:that|this)\s+is\s+)?my\s+number$/iu.test(text)
    || /^(?:you can call me|please call me|yes please call(?: me)?|call me on(?: this)? number)$/iu.test(text)
    || /^(?:نعم\s+)?(?:هذا|ذلك)\s+رقمي$/u.test(text)
    || /^(?:يمكنكم|يمكنك) الاتصال بي$/u.test(text);
}

function callbackConsentQuestion(value) {
  const text = String(value || '');
  return /\b(?:may|can|could|would)\b.{0,100}\b(?:course )?coordinator\b.{0,100}\bcall you on this number\b/iu.test(text)
    || /هل.{0,100}(?:منسق|منسقة).{0,80}(?:يتصل|تتصل|الاتصال).{0,80}(?:هذا الرقم|رقمك)/u.test(text);
}

async function callbackConsentPromptWasAsked(pool, { uid, chatId, origin }) {
  if (!uid || !chatId || !['qr', 'meta'].includes(origin)) return false;
  const uidHash = crypto.createHash('sha256').update(uid).digest('hex');
  const [[lead]] = await pool.query(`SELECT l.qualification_data FROM pipeline_conversations c
    JOIN pipeline_leads l ON l.uid_hash=c.uid_hash AND l.id=c.lead_id
    WHERE c.uid_hash=? AND l.uid=? AND c.chat_id=? AND c.origin=? ORDER BY c.last_inbound_at DESC,c.id DESC LIMIT 1`,
  [uidHash, uid, chatId, origin]);
  const qualification = parse(lead?.qualification_data);
  if (qualification.botCapture?.callbackConsentPending === true) return true;
  const [rows] = await pool.query(`SELECT route,msgContext FROM beta_conversation
    WHERE uid=? AND chat_id=? AND origin=? AND route IN ('INCOMING','OUTGOING') ORDER BY id DESC LIMIT 2`, [uid, chatId, origin]);
  if (rows.length !== 2 || rows[0].route !== 'INCOMING' || rows[1].route !== 'OUTGOING') return false;
  let priorReply = rows[1].msgContext;
  try { if (typeof priorReply === 'string') priorReply = JSON.parse(priorReply); } catch { priorReply = null; }
  const body = priorReply?.text?.body ?? priorReply?.button?.text ?? priorReply?.interactive?.button_reply?.title ?? '';
  return callbackConsentQuestion(body);
}

function genericCaptureEnabled(ctx) {
  return ctx?.category?.chatbotLeadCapture === 'generic'
    && require('./policy').decision(ctx, { capability: 'crm.leads', permission: 'leads.manage' }).allowed;
}

function customerName(text, waitingForName = false) {
  const explicit = String(text || '').match(/(?:^|[.!?،]\s*)(?:my name is|my name's|call me|i am|i'm|this is|اسمي|انا اسمي)\s+([^.!?؟،\n]+)/iu);
  let value = explicit?.[1]?.split(/\s+(?:and\b|(?:و?اريد|و?أريد|و?مهتم)(?=\s|$)|interested\b|looking\b|i want\b)/iu)[0]?.trim();
  const candidate = String(text || '').trim();
  if (!value && (context.isTrainingGreeting(candidate) || context.isCertificateQuestion(candidate))) return null;
  const questionOrCourseQuery = /[?؟]|^(?:which|what|how|when|where|why|who|can|could|will|would|is|are|do|does|did|should)\b|^(?:ما|ماذا|هل|كيف|متى|اين|أين|ايش)|\b(?:certificate|certification|accredited|accreditation|syllabus|curriculum|module|topic|duration|fee|price|cost|schedule|timing|location|online|class|course|training)\b|(?:شهاد|اعتماد|منهج|مدة|رسوم|سعر|مواعيد|جدول|موقع|دورة|تدريب)/iu.test(candidate);
  if (!value && waitingForName && !questionOrCourseQuery && /^[\p{L}\p{M} .'-]{2,80}$/u.test(candidate)) value = candidate;
  if (/^(?:i |i'm |can |do |is |the |انا |أنا |هل |عندي |ممكن )/iu.test(value || '')) return null;
  if (!value || value.length > 80 || value.split(/\s+/).length > 6 || /\b(?:hi|hello|hey|good|morning|evening|yes|no|thanks|thank|okay|ok|more|detail|details|again|other|another|great|fine|sure|course|courses|excel|office|price|fee|agent|human|reset|how|what|when|where|want|need|please|class|classes|schedule|timing|location|center|centre|admission|enrol|register|online|weekend|evening|today|tomorrow|help|form|application|send|share|beginner|interested|studying|enrolled|looking|asking)\b|مرحبا|شكرا|دورة|رسوم|موظف|كيف|متى|ماذا|اريد|أريد/iu.test(value)) return null;
  return value;
}

function nameCandidateForTurn(prior, savedNameCandidate) {
  return prior?.nameCandidate || (!prior?.nameCandidateRejected ? savedNameCandidate : null) || null;
}

function qualificationFromText(text, state = null) {
  const data = {};
  const email = String(text).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  if (email && (String(text).trim() === email || /my email|email\s*[:=]|بريدي|ايميلي|إيميلي/iu.test(text))) data.email = email.toLowerCase().slice(0, 254);
  const interest = String(text).match(/(?:interested in|looking for|course in|مهتم ب(?:دورة)?|دورة في)\s+([^.!?؟\n]+)/iu)?.[1];
  if (interest) data.courseInterest = context.redactCustomerText(interest).slice(0, 180);
  const namedTopic = context.courseInquiryTopic(text, state);
  if (namedTopic) data.courseInterest = namedTopic.slice(0, 180);
  if (/evening|weekend|morning|afternoon|مساء|صباح|نهاية الاسبوع|عطلة/i.test(text)) data.preferredSchedule = String(text).slice(0, 255);
  const goal = String(text).match(/(?:i want to|my goal is|اريد ان|أريد أن)\s+([^.!?؟\n]+)/iu)?.[1];
  if (goal) data.learningGoal = context.redactCustomerText(goal).slice(0, 500);
  return data;
}

async function savedContactName(db, { uid, uidHash, category, phone, lead, checkByPhone }) {
  const storedName = [lead?.learner_name, lead?.linkedContactName, lead?.contact_name].map(value => customerName(value, true)).find(Boolean);
  if (!phone || !checkByPhone) return storedName;
  const [[matchedContact]] = await db.query(`SELECT display_name AS name FROM pipeline_contacts
    WHERE uid_hash=? AND uid=? AND normalized_phone=? AND id<>?
    ORDER BY created_at DESC,id LIMIT 1`, [uidHash, uid, phone, lead?.contact_id || '']);
  const existingName = customerName(matchedContact?.name, true) || storedName;
  if (existingName) return existingName;
  const { contacts, truncated } = await require('./phonebook-workspace').contactsByMobile(db,
    { uid, hash: uidHash, category, manage: true }, { mobile: phone });
  const names = new Map(contacts.map(row => customerName(row.name, true)).filter(Boolean)
    .map(value => [context.normalized(value), value]));
  return !truncated && names.size === 1 ? names.values().next().value : null;
}

async function captureLead(pool, { ctx, profile, uid, chatId, origin, message, facts, legacyCallbackConsentPrompted = false }) {
  if (ctx.tenant.categoryKey !== 'training_center' || !recipientAllowed(profile.config, message.senderMobile, profile.id)) return null;
  const text = String(message?.msgContext?.text?.body ?? message?.msgContext?.button?.text ?? message?.msgContext?.interactive?.button_reply?.title ?? message?.msgContext?.interactive?.list_reply?.title
    ?? message?.msgContext?.image?.caption ?? message?.msgContext?.video?.caption ?? message?.msgContext?.document?.caption ?? '').trim().slice(0, 2000);
  const captured = await require('../../helper/pipeline/leadPipeline').captureBotInbound({ uid, origin, chatId, senderMobile: message.senderMobile, senderName: message.senderName, normalizedMessage: message, providerMessageId: message.metaChatId, timestamp: message.timestamp, pool });
  if (!captured.leadId) throw Object.assign(new Error('BOT_LEAD_NOT_CAPTURED'), { code: 'BOT_LEAD_NOT_CAPTURED' });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const uidHash = crypto.createHash('sha256').update(uid).digest('hex');
    const [[lead]] = await db.query(`SELECT l.id,l.contact_id,l.learner_name,l.contact_name,l.qualification_data,c.display_name AS linkedContactName
      FROM pipeline_leads l LEFT JOIN pipeline_contacts c ON c.uid_hash=l.uid_hash AND c.uid=l.uid AND c.id=l.contact_id
      WHERE l.uid_hash=? AND l.uid=? AND l.id=? FOR UPDATE`, [uidHash, uid, captured.leadId]);
    if (!lead) throw Object.assign(new Error('BOT_LEAD_NOT_FOUND'), { code: 'BOT_LEAD_NOT_FOUND' });
    const qualification = parse(lead.qualification_data);
    const prior = qualification.botCapture || {};
    const senderIsQatar = Boolean(qatarMobile(message.senderMobile));
    const waitingForQatar = qatarCallbackEnabled(ctx) && ['qatarContact', 'callbackContact'].includes(prior.waitingFor);
    const qatarContactNumber = waitingForQatar ? qatarMobileFromText(text) : null;
    const qatarContactInvalid = waitingForQatar && !qatarContactNumber && phoneOnly(text);
    const inboundKey = context.fingerprint([profile.channelKind, profile.channelRef, chatId, message.metaChatId]).slice(0, 24);
    const previousKeys = Array.isArray(prior.inboundKeys) ? prior.inboundKeys : [];
    const alreadyCaptured = previousKeys.includes(inboundKey);
    const priorCourseDigits = normalizedDigits(qualification.courseInterest || '').replace(/\D/g, '');
    const incomingDigits = normalizedDigits(text).replace(/\D/g, '');
    const qatarDigits = normalizedDigits(qatarContactNumber || '').replace(/\D/g, '');
    const stalePhoneCourseInterest = !alreadyCaptured && qatarContactNumber && phoneOnly(qualification.courseInterest)
      && (priorCourseDigits === incomingDigits || priorCourseDigits === qatarDigits);
    const retrieval = context.retrieveContext({ facts, message: text, referral: message?.msgContext?.referral || null });
    let courses = retrieval.explicitCourses ? retrieval.evidence.filter(item => item.kind === 'course') : [];
    let guidedState = {};
    if (profile.channelKind && profile.channelRef) {
      const [[session]] = await db.query('SELECT state FROM sx_chatbot_guided_sessions WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND expires_at>UTC_TIMESTAMP(3)', [ctx.tenant.id, profile.id, profile.channelKind, profile.channelRef, chatId]);
      guidedState = parse(session?.state);
    }
    if (!courses.length && profile.channelKind && profile.channelRef) {
      const state = guidedState;
      const choice = context.normalized(text);
      const code = state.step === 'course_list' && /^\d{1,2}$/.test(choice) ? state.courseCodes?.[Number(choice) - 1] : !qualification.courseInterest ? state.selectedCourseCode : null;
      const selected = facts.find(item => item.code === code);
      if (selected) courses = [{ kind: 'course', code: selected.code, name: retrieval.language === 'ar' ? selected.nameAr || selected.nameEn : selected.nameEn || selected.nameAr }];
    }
    const useIntake = admissions.enabled(ctx.tenant.id);
    const phone = require('../../helper/pipeline/leadPipeline').normalizePhone(message.senderMobile);
    const storedName = await savedContactName(db, { lead });
    const savedNameCandidate = !prior.nameConfirmed
      ? await savedContactName(db, { uid, uidHash, category: ctx.tenant.categoryKey, phone, lead, checkByPhone: Boolean(phone) })
      : null;
    const nameCandidate = nameCandidateForTurn(prior, savedNameCandidate);
    const intakeScope = useIntake ? context.fingerprint([profile.channelKind, profile.channelRef, chatId]).slice(0, 24) : null;
    const priorIntake = prior.admissions?.scope === intakeScope && Date.now() - Number(prior.admissions.lastSeen || 0) < 24 * 60 * 60 * 1000
      ? prior.admissions : { scope: intakeScope };
    const waitingForName = useIntake ? ['name', 'confirmName'].includes(priorIntake.waiting)
      : ['name', 'confirmName', 'callbackContact'].includes(prior.waitingFor);
    const nameText = qatarContactNumber
      ? text.replace(qatarContactNumber, '').replace(/(?:\+?974[\s().-]*)?[3567](?:[\s().-]*\d){7}/u, '').trim()
      : text;
    const shortAnswer = context.normalized(nameText).replace(/[.!?؟]+$/u, '');
    const callbackConsentNumber = prior.callbackConsentNumber || qualification.qatarContactNumber || qatarMobile(message.senderMobile);
    const callbackConsentPromptPending = prior.callbackConsentPending === true || legacyCallbackConsentPrompted === true;
    const confirmsSavedName = prior.nameConfirmationPending === true
      && (nameConfirmationReply(shortAnswer) || (!callbackConsentPromptPending && affirmativeReply(shortAnswer)));
    const rejectsSavedName = prior.nameConfirmationPending === true && /^(?:no|no thats wrong|thats wrong|incorrect|not correct|لا|ليس صحيحا|غير صحيح)$/iu.test(shortAnswer);
    const callbackConsentIsNew = Boolean(callbackConsentNumber && callbackConsentPromptPending && callbackConsentReply(text));
    const callbackConsentSubmitted = callbackConsentIsNew || Boolean(prior.callbackConsentConfirmed === true && prior.callbackConsentInboundKey === inboundKey);
    const callbackConsentEventKey = callbackConsentIsNew
      ? context.fingerprint([profile.channelKind, profile.channelRef, chatId, inboundKey, 'callback-consent']).slice(0, 24)
      : prior.callbackConsentInboundKey === inboundKey ? prior.callbackConsentEventKey || null : null;
    let name = confirmsSavedName ? nameCandidate
      : rejectsSavedName ? null
        : customerName(nameText, waitingForName && !courses.length && !(useIntake && admissions.acknowledgement(text)));
    const simpleName = name && ['', 'my name is ', 'my name s ', 'call me ', 'اسمي ', 'انا اسمي '].some(prefix => context.normalized(text) === prefix + context.normalized(name));
    const details = qualificationFromText(text, guidedState);
    if (useIntake && !details.courseInterest) details.courseInterest = admissions.courseInterest(text);
    if (!alreadyCaptured && courses.length) qualification.courseInterest = courses.map(item => item.name).join('; ').slice(0, 180);
    else if (!alreadyCaptured && details.courseInterest) qualification.courseInterest = details.courseInterest;
    if (stalePhoneCourseInterest && !(courses.length || details.courseInterest)) delete qualification.courseInterest;
    if (!alreadyCaptured && qatarContactNumber) qualification.qatarContactNumber = qatarContactNumber;
    for (const key of ['preferredSchedule', 'learningGoal']) if (!alreadyCaptured && details[key]) qualification[key] = details[key];
    let meta = { ...prior };
    if (stalePhoneCourseInterest && !(courses.length || details.courseInterest)) meta.courseConfirmed = false;
    if (!alreadyCaptured && name) {
      meta.nameConfirmed = true;
      meta.nameAsked = true;
      meta.contactNamePrompted = true;
      meta.nameConfirmationPending = false;
      meta.nameCandidateRejected = false;
      delete meta.nameCandidate;
    }
    if (!alreadyCaptured && confirmsSavedName) {
      meta.nameConfirmed = true;
      meta.nameAsked = true;
      meta.contactNamePrompted = true;
      meta.nameConfirmationPending = false;
      meta.nameCandidateRejected = false;
      delete meta.nameCandidate;
    } else if (!alreadyCaptured && rejectsSavedName) {
      meta.nameConfirmed = false;
      meta.nameAsked = false;
      meta.contactNamePrompted = false;
      meta.nameConfirmationPending = false;
      meta.nameCandidateRejected = true;
      delete meta.nameCandidate;
      meta.waitingFor = 'name';
    } else if (!alreadyCaptured && !meta.nameConfirmed && nameCandidate && !meta.contactNamePrompted) {
      meta.nameCandidate = nameCandidate;
      meta.nameConfirmationPending = true;
    }
    if (!alreadyCaptured && courses.length) meta.courseConfirmed = true;
    if (!alreadyCaptured && details.courseInterest) meta.courseConfirmed = true;
    if (!alreadyCaptured && callbackConsentIsNew) {
      meta.callbackConsentPending = false;
      meta.callbackRequested = true;
      meta.callbackConsentConfirmed = true;
      meta.callbackConsentNumber = callbackConsentNumber;
      meta.callbackConsentInboundKey = inboundKey;
      meta.callbackConsentEventKey = callbackConsentEventKey;
    }
    if (!alreadyCaptured && qatarContactNumber) {
      meta.qatarContactAsked = true;
      meta.qatarContactCaptured = true;
      if (meta.waitingFor === 'qatarContact' || meta.waitingFor === 'callbackContact') {
        meta.waitingFor = meta.nameConfirmationPending ? 'confirmName' : !meta.nameConfirmed ? 'name' : null;
      }
    }
    if (!alreadyCaptured && /^(?:reset bot|restart bot|إعادة ضبط الروبوت)$/iu.test(text)) meta = { ...meta, waitingFor: null, nameAsked: false, courseAsked: false };
    if (!alreadyCaptured) meta.inboundKeys = [...previousKeys, inboundKey].slice(-25);
    const language = context.languageFor(text, guidedState);
    let intake = null;
    if (useIntake) {
      // The linked lead is selected under the normalized WhatsApp number lock.
      const fullSavedName = await savedContactName(db, { uid, uidHash, category: ctx.tenant.categoryKey, phone, lead,
        checkByPhone: !name && !priorIntake.nameConfirmed && !prior.nameConfirmed && !priorIntake.replaceName });
      const savedName = fullSavedName?.split(/\s+/u)[0];
      const savedStart = admissions.savedStartLabel(qualification, language);
      const enquiryChanged = priorIntake.courseInterest && qualification.courseInterest !== priorIntake.courseInterest;
      const currentIntake = enquiryChanged
        ? { ...priorIntake, startConfirmed: false, startAsked: 0, confirmStartAsked: 0, replaceStart: false, waiting: null }
        : priorIntake;
      intake = waitingForQatar && (qatarContactNumber || qatarContactInvalid)
        ? { state: { ...priorIntake, lastSeen: Date.now() }, key: null, prompt: null, courseInterest: qualification.courseInterest || null }
        : admissions.advance({ prior: currentIntake, text, name, nameOnly: !!simpleName && !retrieval.explicitCourses,
          savedName, savedStart, language });
      if (!alreadyCaptured) {
        if (!name && !priorIntake.nameConfirmed && intake.state.nameConfirmed) name = fullSavedName;
        if (name) meta.nameConfirmed = true;
        if (intake.start) {
          qualification.preferredStartDetail = intake.start.detail;
          if (intake.start.window) qualification.preferredStartWindow = intake.start.window;
          else delete qualification.preferredStartWindow;
        }
        meta.admissions = { ...intake.state, courseInterest: qualification.courseInterest || null, lastSeen: Date.now() };
      }
      intake.session = guidedState;
      intake.name = intake.state.nameConfirmed ? name || storedName : null;
      intake.preferredStart = intake.state.startConfirmed ? admissions.savedStartLabel(qualification, language) : null;
    }
    const needsName = useIntake ? intake?.state?.nameConfirmed !== true : !meta.nameConfirmed;
    const needsQatarNumber = qatarCallbackEnabled(ctx) && !senderIsQatar && !qualification.qatarContactNumber;
    const courseDiscoveryOptOut = context.isCourseDiscoveryOptOut(text);
    if (!alreadyCaptured && courseDiscoveryOptOut) {
      // A refusal closes the pending discovery prompt. Do not turn it into
      // another course, name, or callback question.
      meta.courseAsked = true;
      meta.waitingFor = null;
    }
    const contactPromptPending = !useIntake && !courseDiscoveryOptOut && (
      (needsName && !meta.contactNamePrompted) || (needsQatarNumber && !meta.qatarContactAsked)
    );
    const questionKey = useIntake || contactPromptPending || ['qatarContact', 'callbackContact'].includes(meta.waitingFor)
      || courseDiscoveryOptOut || qualification.courseInterest || meta.courseAsked ? null : 'collectCourseMessage';
    qualification.botCapture = meta;
    const changed = !alreadyCaptured && (JSON.stringify(qualification) !== JSON.stringify(parse(lead.qualification_data)) || (name && name !== lead.learner_name) || !!details.email);
    if (changed) {
      await db.query('UPDATE pipeline_leads SET qualification_data=?,learner_name=COALESCE(?,learner_name),contact_name=COALESCE(?,contact_name),last_activity_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND uid=? AND id=?', [JSON.stringify(qualification), name, name, uidHash, uid, lead.id]);
      if (lead.contact_id && (name || details.email)) await db.query('UPDATE pipeline_contacts SET display_name=COALESCE(?,display_name),normalized_email=COALESCE(?,normalized_email) WHERE uid_hash=? AND uid=? AND id=?', [name, details.email || null, uidHash, uid, lead.contact_id]);
      const old = parse(lead.qualification_data);
      const fields = [...(name && (name !== lead.learner_name || !prior.nameConfirmed) ? ['learnerName'] : []), ...['courseInterest','qatarContactNumber','preferredSchedule','preferredStartWindow','preferredStartDetail','learningGoal'].filter(key => qualification[key] !== old[key]), ...(details.email ? ['email'] : [])];
      if (fields.length) await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,activity_type,summary,details,created_at) VALUES (?,?,'system','lead_updated','Bot saved learner enquiry details',?,UTC_TIMESTAMP(3))`, [uidHash, lead.id, JSON.stringify({ origin: 'chatbot', profileId: profile.id, fields, ...(fields.includes('courseInterest') ? { courseInterest: qualification.courseInterest } : {}) })]);
    }
    if (!alreadyCaptured && callbackConsentIsNew) {
      await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,activity_type,summary,details,created_at)
        VALUES (?,?,'system','callback_requested','Customer confirmed a course coordinator callback',?,UTC_TIMESTAMP(3))`,
      [uidHash, lead.id, JSON.stringify({ origin: 'chatbot', profileId: profile.id, callbackNumber: callbackConsentNumber,
        courseInterest: qualification.courseInterest || null, consent: true, requestKey: callbackConsentEventKey })]);
    }
    await db.commit();
    return { leadId: lead.id, uidHash, facts, questionKey, language, nameCaptured: !!name, nameOnly: !!simpleName && !retrieval.explicitCourses,
      courseInterest: qualification.courseInterest || null, intake, senderIsQatar, callbackNumber: callbackConsentNumber || qatarMobile(message.senderMobile),
      name: name || (meta.nameConfirmed ? storedName : null),
      nameConfirmationSubmitted: Boolean(!alreadyCaptured && confirmsSavedName),
      callbackConsentSubmitted: Boolean(callbackConsentSubmitted && callbackConsentEventKey),
      callbackConsentConfirmed: meta.callbackConsentConfirmed === true,
      callbackConsentEventKey,
      qatarContactNumber: qualification.qatarContactNumber || null,
      qatarContactPending: needsQatarNumber,
      qatarContactAsked: prior.qatarContactAsked === true,
      needsName,
      nameCandidate: meta.nameConfirmationPending === true ? nameCandidate : null,
      nameConfirmationPending: meta.nameConfirmationPending === true,
      contactPromptPending,
      contactPromptHandOffPending: needsName || needsQatarNumber,
      qatarContactSubmitted: Boolean(!alreadyCaptured && qatarContactNumber), qatarContactInvalid,
      qatarContactPhoneOnly: qatarContactInvalid && phoneOnly(text) };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

async function captureGenericLead(pool, { ctx, profile, uid, chatId, origin, message }) {
  if (!genericCaptureEnabled(ctx) || profile?.config?.captureLeads !== true
    || !recipientAllowed(profile.config, message?.senderMobile, profile.id)) return null;
  const captured = await require('../../helper/pipeline/leadPipeline').captureBotInbound({
    uid, origin, chatId, senderMobile: message.senderMobile, senderName: message.senderName,
    normalizedMessage: message, providerMessageId: message.metaChatId, timestamp: message.timestamp, pool,
  });
  if (captured.skipped || !captured.leadId) throw Object.assign(new Error('BOT_LEAD_NOT_CAPTURED'), { code: 'BOT_LEAD_NOT_CAPTURED' });
  return { leadId: captured.leadId, duplicate: captured.duplicate === true };
}

function standaloneNamePrompt(info) {
  if (!['name', 'confirmName'].includes(info?.intake?.key)) return null;
  return info.courseInterest || info.intake.session.admissionsEscalation ? info.intake.prompt : null;
}

function addQuestion(reply, info, config, defaults) {
  if (info?.contactPrompt) {
    const prompt = String(info.contactPrompt).replaceAll('{name}', String(info.nameCandidate || '').trim()).trim();
    return prompt ? appendDistinctPrompt(reply, prompt) : reply;
  }
  if (info?.intake) {
    if (standaloneNamePrompt(info) || !info.intake.prompt || (!info.courseInterest && !info.intake.session.admissionsEscalation)) return reply;
    return appendPrompt(reply, info.intake.prompt);
  }
  if (!info?.questionKey) return reply;
  if (info.questionKey === 'collectCourseMessage'
    && /\b(?:which|what)\s+(?:course|diploma|programme|program|training)\b[^?؟\n]{0,140}[?؟]|\b(?:course|diploma|programme|program|training)\b[^?؟\n]{0,100}\b(?:interested|looking for|mean|refer(?:ring)? to)\b[^?؟\n]*[?؟]|(?:أي|ما)\s+(?:دورة|دبلوم|برنامج)[^؟\n]{0,140}؟/iu.test(String(reply || ''))) return reply;
  const text = config?.guidedContent?.messages?.[info.questionKey]?.[info.language] || defaults?.messages?.[info.questionKey]?.[info.language];
  if (!text) return reply;
  return appendPrompt(reply, text);
}

function appendDistinctPrompt(reply, text) {
  const body = String(reply || '').trim();
  if (!text || body.includes(text)) return body;
  return [body, text].filter(Boolean).join('\n\n');
}

function appendPrompt(reply, text) {
  return [reply.replace(/[^\n.!?؟]*[?؟]\s*$/u, '').trim(), text].filter(Boolean).join('\n\n');
}

function addQatarContactQuestion(reply, info) {
  if (!info?.qatarContactPending) return reply;
  const question = info.language === 'ar'
    ? info.qatarContactAsked
      ? 'يلزم رقم جوال قطري (+974، من 8 أرقام) ليتمكن منسقو الدورات من التواصل معك. يرجى إرساله عندما تكون مستعدًا.'
      : 'بما أنك تتواصل معنا من خارج قطر، يرجى إرسال رقم جوال قطري (+974، من 8 أرقام) ليتمكن منسقو الدورات من التواصل معك.'
    : info.qatarContactAsked
      ? 'Our course coordinators need a Qatar mobile number (+974, 8 digits) to contact you. Please send it when you’re ready.'
      : 'Since you’re messaging from outside Qatar, please send a Qatar mobile number (+974, 8 digits) so our course coordinators can contact you.';
  return appendPrompt(String(reply || ''), question);
}

async function markQatarContactAsked(pool, info, uid) {
  if (!info?.qatarContactPending || !info?.leadId || !info?.uidHash || !uid) return;
  const db = await pool.getConnection();
  try {
    await db.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(COALESCE(qualification_data,JSON_OBJECT()),
      '$.botCapture.qatarContactAsked',true,'$.botCapture.waitingFor','qatarContact',
      '$.botCapture.courseAsked',true)
      WHERE uid_hash=? AND uid=? AND id=?`, [info.uidHash, uid, info.leadId]);
  } finally { db.release(); }
}

async function markContactPromptAsked(pool, info, uid) {
  if (!info?.contactPromptPending || !info?.leadId || !info?.uidHash || !uid) return;
  const waitingFor = info.qatarContactPending
    ? (info.nameConfirmationPending ? 'callbackContact' : 'qatarContact')
    : (info.nameConfirmationPending ? 'confirmName' : 'name');
  await pool.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(COALESCE(qualification_data,JSON_OBJECT()),
    '$.botCapture.contactNamePrompted',true,
    '$.botCapture.nameAsked',true,
    '$.botCapture.nameConfirmationPending',?,
    '$.botCapture.nameCandidate',?,
    '$.botCapture.qatarContactAsked',IF(?,true,COALESCE(JSON_EXTRACT(qualification_data,'$.botCapture.qatarContactAsked'),false)),
    '$.botCapture.waitingFor',?)
    WHERE uid_hash=? AND uid=? AND id=?`,
  [info.nameConfirmationPending === true, info.nameCandidate || null, info.qatarContactPending === true,
    waitingFor, info.uidHash, uid, info.leadId]);
}

async function markCallbackConsentPromptAsked(pool, info, uid) {
  if (!info?.leadId || !info?.uidHash || !uid) return;
  const number = qatarMobile(info.callbackNumber || info.qatarContactNumber);
  if (!number) return;
  await pool.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(COALESCE(qualification_data,JSON_OBJECT()),
    '$.botCapture.callbackConsentPending',true,'$.botCapture.callbackConsentNumber',?)
    WHERE uid_hash=? AND uid=? AND id=?`, [number, info.uidHash, uid, info.leadId]);
}

async function reserveCallbackAcknowledgement(pool, info, uid) {
  if (!info?.leadId || !info?.uidHash || !uid || !info.callbackConsentEventKey) return false;
  const [result] = await pool.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(COALESCE(qualification_data,JSON_OBJECT()),
    '$.botCapture.callbackAcknowledgementEventKey',?)
    WHERE uid_hash=? AND uid=? AND id=?
      AND JSON_UNQUOTE(JSON_EXTRACT(qualification_data,'$.botCapture.callbackConsentEventKey'))=?
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(qualification_data,'$.botCapture.callbackAcknowledgementEventKey')),'')<>?`,
  [info.callbackConsentEventKey, info.uidHash, uid, info.leadId, info.callbackConsentEventKey, info.callbackConsentEventKey]);
  return result.affectedRows === 1;
}

async function releaseCallbackAcknowledgement(pool, info, uid) {
  if (!info?.leadId || !info?.uidHash || !uid || !info.callbackConsentEventKey) return;
  await pool.query(`UPDATE pipeline_leads SET qualification_data=JSON_REMOVE(qualification_data,'$.botCapture.callbackAcknowledgementEventKey')
    WHERE uid_hash=? AND uid=? AND id=?
      AND JSON_UNQUOTE(JSON_EXTRACT(qualification_data,'$.botCapture.callbackAcknowledgementEventKey'))=?`,
  [info.uidHash, uid, info.leadId, info.callbackConsentEventKey]);
}

async function markAsked(pool, info, uid) {
  if (info?.intake) {
    if (!info.intake.key || (!info.courseInterest && !info.intake.session.admissionsEscalation)) return;
    const counter = '$.botCapture.admissions.' + info.intake.key + 'Asked';
    await pool.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(qualification_data,
      '$.botCapture.admissions.waiting', ?, ?, COALESCE(JSON_EXTRACT(qualification_data, ?),0)+1)
      WHERE uid_hash=? AND uid=? AND id=? AND JSON_UNQUOTE(JSON_EXTRACT(qualification_data,'$.botCapture.admissions.scope'))=?`,
    [info.intake.key, counter, counter, info.uidHash, uid, info.leadId, info.intake.state.scope]);
    return;
  }
  if (!info?.questionKey) return;
  const key = info.questionKey === 'collectNameMessage' ? 'name' : 'course';
  const db = await pool.getConnection();
  try {
    await db.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(COALESCE(qualification_data,JSON_OBJECT()),?,true,'$.botCapture.waitingFor',?) WHERE uid_hash=? AND uid=? AND id=?`, ['$.botCapture.' + key + 'Asked', key, info.uidHash, uid, info.leadId]);
  } finally { db.release(); }
}
async function markCourseAsked(pool, info, uid) {
  if (!info?.leadId || !info?.uidHash || !uid) return;
  const db = await pool.getConnection();
  try {
    await db.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(COALESCE(qualification_data,JSON_OBJECT()),'$.botCapture.courseAsked',true,'$.botCapture.waitingFor','course') WHERE uid_hash=? AND uid=? AND id=?`, [info.uidHash, uid, info.leadId]);
  } finally { db.release(); }
}
module.exports = { savedContactName, captureLead, captureGenericLead, genericCaptureEnabled, customerName, qualificationFromText,
  qatarMobile, qatarMobileFromText, phoneOnly, qatarCallbackEnabled, addQuestion, addQatarContactQuestion,
  affirmativeReply, nameConfirmationReply, callbackConsentReply, callbackConsentPromptWasAsked, markQatarContactAsked, markContactPromptAsked, markCallbackConsentPromptAsked,
  reserveCallbackAcknowledgement, releaseCallbackAcknowledgement, standaloneNamePrompt, markAsked, markCourseAsked, nameCandidateForTurn };
