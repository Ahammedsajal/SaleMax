'use strict';
const crypto = require('node:crypto');
const context = require('./chatbot-business-context');
const admissions = require('./chatbot-admissions-intake');
const { recipientAllowed } = require('./chatbot-audience');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value || {};

function genericCaptureEnabled(ctx) {
  return ctx?.category?.chatbotLeadCapture === 'generic'
    && require('./policy').decision(ctx, { capability: 'crm.leads', permission: 'leads.manage' }).allowed;
}

function customerName(text, waitingForName = false) {
  const explicit = String(text || '').match(/(?:^|[.!?،]\s*)(?:my name is|my name's|call me|اسمي|انا اسمي)\s+([^.!?؟،\n]+)/iu);
  let value = explicit?.[1]?.split(/\s+(?:and\b|(?:و?اريد|و?أريد|و?مهتم)(?=\s|$)|interested\b|looking\b|i want\b)/iu)[0]?.trim();
  const candidate = String(text || '').trim();
  const questionOrCourseQuery = /[?؟]|^(?:which|what|how|when|where|why|who|can|could|will|would|is|are|do|does|did|should)\b|^(?:ما|ماذا|هل|كيف|متى|اين|أين|ايش)|\b(?:certificate|certification|accredited|accreditation|syllabus|curriculum|module|topic|duration|fee|price|cost|schedule|timing|location|online|class|course|training)\b|(?:شهاد|اعتماد|منهج|مدة|رسوم|سعر|مواعيد|جدول|موقع|دورة|تدريب)/iu.test(candidate);
  if (!value && waitingForName && !questionOrCourseQuery && /^[\p{L}\p{M} .'-]{2,80}$/u.test(candidate)) value = candidate;
  if (/^(?:i |i'm |can |do |is |the |انا |أنا |هل |عندي |ممكن )/iu.test(value || '')) return null;
  if (!value || value.length > 80 || value.split(/\s+/).length > 6 || /\b(?:hi|hello|hey|good|morning|evening|yes|no|thanks|thank|okay|ok|more|detail|details|again|other|another|great|fine|sure|course|courses|excel|office|price|fee|agent|human|reset|how|what|when|where|want|need|please|class|classes|schedule|timing|location|center|centre|admission|enrol|register|online|weekend|evening|today|tomorrow|help|form|application|send|share)\b|مرحبا|شكرا|دورة|رسوم|موظف|كيف|متى|ماذا|اريد|أريد/iu.test(value)) return null;
  return value;
}

function qualificationFromText(text) {
  const data = {};
  const email = String(text).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  if (email && (String(text).trim() === email || /my email|email\s*[:=]|بريدي|ايميلي|إيميلي/iu.test(text))) data.email = email.toLowerCase().slice(0, 254);
  const interest = String(text).match(/(?:interested in|looking for|course in|مهتم ب(?:دورة)?|دورة في)\s+([^.!?؟\n]+)/iu)?.[1];
  if (interest) data.courseInterest = context.redactCustomerText(interest).slice(0, 180);
  if (/evening|weekend|morning|afternoon|مساء|صباح|نهاية الاسبوع|عطلة/i.test(text)) data.preferredSchedule = String(text).slice(0, 255);
  const goal = String(text).match(/(?:i want to|my goal is|اريد ان|أريد أن)\s+([^.!?؟\n]+)/iu)?.[1];
  if (goal) data.learningGoal = context.redactCustomerText(goal).slice(0, 500);
  return data;
}

async function captureLead(pool, { ctx, profile, uid, chatId, origin, message, facts }) {
  if (ctx.tenant.categoryKey !== 'training_center' || !recipientAllowed(profile.config, message.senderMobile, profile.id)) return null;
  const text = String(message?.msgContext?.text?.body ?? message?.msgContext?.button?.text ?? message?.msgContext?.interactive?.button_reply?.title ?? message?.msgContext?.interactive?.list_reply?.title ?? '').trim().slice(0, 2000);
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
    const inboundKey = context.fingerprint([profile.channelKind, profile.channelRef, chatId, message.metaChatId]).slice(0, 24);
    const previousKeys = Array.isArray(prior.inboundKeys) ? prior.inboundKeys : [];
    const alreadyCaptured = previousKeys.includes(inboundKey);
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
    const intakeScope = useIntake ? context.fingerprint([profile.channelKind, profile.channelRef, chatId]).slice(0, 24) : null;
    const priorIntake = prior.admissions?.scope === intakeScope && Date.now() - Number(prior.admissions.lastSeen || 0) < 24 * 60 * 60 * 1000
      ? prior.admissions : { scope: intakeScope };
    const waitingForName = useIntake ? ['name', 'confirmName'].includes(priorIntake.waiting) : prior.waitingFor === 'name';
    let name = customerName(text, waitingForName && !courses.length && !(useIntake && admissions.acknowledgement(text)));
    const simpleName = name && ['', 'my name is ', 'my name s ', 'call me ', 'اسمي ', 'انا اسمي '].some(prefix => context.normalized(text) === prefix + context.normalized(name));
    const details = qualificationFromText(text);
    if (useIntake && !details.courseInterest) details.courseInterest = admissions.courseInterest(text);
    if (!alreadyCaptured && courses.length) qualification.courseInterest = courses.map(item => item.name).join('; ').slice(0, 180);
    else if (!alreadyCaptured && details.courseInterest) qualification.courseInterest = details.courseInterest;
    for (const key of ['preferredSchedule', 'learningGoal']) if (!alreadyCaptured && details[key]) qualification[key] = details[key];
    let meta = { ...prior };
    if (!alreadyCaptured && name) meta.nameConfirmed = true;
    if (!alreadyCaptured && courses.length) meta.courseConfirmed = true;
    if (!alreadyCaptured && /^(?:reset bot|restart bot|إعادة ضبط الروبوت)$/iu.test(text)) meta = { ...meta, waitingFor: null, nameAsked: false, courseAsked: false };
    if (!alreadyCaptured) meta.inboundKeys = [...previousKeys, inboundKey].slice(-25);
    const language = context.languageFor(text, guidedState);
    let intake = null;
    if (useIntake) {
      const storedName = [lead.learner_name, lead.linkedContactName, lead.contact_name].map(value => customerName(value, true)).find(Boolean);
      // captureBotInbound selects this lead under the account's normalized
      // WhatsApp number lock. An imported contact may predate that lock.
      const phone = require('../../helper/pipeline/leadPipeline').normalizePhone(message.senderMobile);
      let existingName = null;
      if (!name && !priorIntake.nameConfirmed && !prior.nameConfirmed) {
        const [[matchedContact]] = await db.query(`SELECT display_name AS name FROM pipeline_contacts
          WHERE uid_hash=? AND uid=? AND normalized_phone=? AND id<>?
          ORDER BY created_at DESC,id LIMIT 1`, [uidHash, uid, phone, lead.contact_id || '']);
        existingName = customerName(matchedContact?.name, true);
      }
      let fullSavedName = existingName || storedName;
      if (!fullSavedName && !name && !priorIntake.nameConfirmed && !priorIntake.replaceName) {
        const { contacts, truncated } = await require('./phonebook-workspace').contactsByMobile(db,
          { uid, hash: uidHash, category: ctx.tenant.categoryKey, manage: true }, { mobile: phone });
        const names = new Map(contacts.map(row => customerName(row.name, true)).filter(Boolean)
          .map(value => [context.normalized(value), value]));
        if (!truncated && names.size === 1) fullSavedName = names.values().next().value;
      }
      const savedName = fullSavedName?.split(/\s+/u)[0];
      const savedStart = admissions.savedStartLabel(qualification, language);
      const enquiryChanged = priorIntake.courseInterest && qualification.courseInterest !== priorIntake.courseInterest;
      const currentIntake = enquiryChanged
        ? { ...priorIntake, startConfirmed: false, startAsked: 0, confirmStartAsked: 0, replaceStart: false, waiting: null }
        : priorIntake;
      intake = admissions.advance({ prior: currentIntake, text, name, nameOnly: !!simpleName && !retrieval.explicitCourses,
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
    const questionKey = useIntake ? null : !meta.nameConfirmed && !meta.nameAsked ? 'collectNameMessage' : !qualification.courseInterest && !meta.courseAsked ? 'collectCourseMessage' : null;
    qualification.botCapture = meta;
    const changed = !alreadyCaptured && (JSON.stringify(qualification) !== JSON.stringify(parse(lead.qualification_data)) || (name && name !== lead.learner_name) || !!details.email);
    if (changed) {
      await db.query('UPDATE pipeline_leads SET qualification_data=?,learner_name=COALESCE(?,learner_name),contact_name=COALESCE(?,contact_name),last_activity_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND uid=? AND id=?', [JSON.stringify(qualification), name, name, uidHash, uid, lead.id]);
      if (lead.contact_id && (name || details.email)) await db.query('UPDATE pipeline_contacts SET display_name=COALESCE(?,display_name),normalized_email=COALESCE(?,normalized_email) WHERE uid_hash=? AND uid=? AND id=?', [name, details.email || null, uidHash, uid, lead.contact_id]);
      const old = parse(lead.qualification_data);
      const fields = [...(name && (name !== lead.learner_name || !prior.nameConfirmed) ? ['learnerName'] : []), ...['courseInterest','preferredSchedule','preferredStartWindow','preferredStartDetail','learningGoal'].filter(key => qualification[key] !== old[key]), ...(details.email ? ['email'] : [])];
      if (fields.length) await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,activity_type,summary,details,created_at) VALUES (?,?,'system','lead_updated','Bot saved learner enquiry details',?,UTC_TIMESTAMP(3))`, [uidHash, lead.id, JSON.stringify({ origin: 'chatbot', profileId: profile.id, fields, ...(fields.includes('courseInterest') ? { courseInterest: qualification.courseInterest } : {}) })]);
    }
    await db.commit();
    return { leadId: lead.id, uidHash, facts, questionKey, language, nameCaptured: !!name, nameOnly: !!simpleName && !retrieval.explicitCourses, courseInterest: qualification.courseInterest || null, intake };
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
  if (info?.intake) {
    if (standaloneNamePrompt(info) || !info.intake.prompt || (!info.courseInterest && !info.intake.session.admissionsEscalation)) return reply;
    return appendPrompt(reply, info.intake.prompt);
  }
  if (!info?.questionKey) return reply;
  const text = config?.guidedContent?.messages?.[info.questionKey]?.[info.language] || defaults?.messages?.[info.questionKey]?.[info.language];
  if (!text) return reply;
  return appendPrompt(reply, text);
}

function appendPrompt(reply, text) {
  return [reply.replace(/[^\n.!?؟]*[?؟]\s*$/u, '').trim(), text].filter(Boolean).join('\n\n');
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
module.exports = { captureLead, captureGenericLead, genericCaptureEnabled, customerName, qualificationFromText, addQuestion, standaloneNamePrompt, markAsked };
