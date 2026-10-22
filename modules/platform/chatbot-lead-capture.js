'use strict';
const crypto = require('node:crypto');
const context = require('./chatbot-business-context');
const { recipientAllowed } = require('./chatbot-audience');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value || {};

function genericCaptureEnabled(ctx) {
  return ctx?.category?.chatbotLeadCapture === 'generic'
    && require('./policy').decision(ctx, { capability: 'crm.leads', permission: 'leads.manage' }).allowed;
}

function usesTrainingLeadCapture(ctx) {
  return ctx?.category?.chatbotLeadCapture === 'training';
}

function customerName(text, waitingForName = false) {
  const explicit = String(text || '').match(/(?:^|[.!?،]\s*)(?:my name is|my name's|call me|اسمي|انا اسمي)\s+([^.!?؟،\n]+)/iu);
  let value = explicit?.[1]?.split(/\s+(?:and\b|(?:و?اريد|و?أريد|و?مهتم)(?=\s|$)|interested\b|looking\b|i want\b)/iu)[0]?.trim();
  if (!value && waitingForName && /^[\p{L}\p{M} .'-]{2,80}$/u.test(String(text || '').trim())) value = String(text).trim();
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
  if (!usesTrainingLeadCapture(ctx) || !recipientAllowed(profile.config, message.senderMobile)) return null;
  const text = String(message?.msgContext?.text?.body ?? message?.msgContext?.button?.text ?? message?.msgContext?.interactive?.button_reply?.title ?? message?.msgContext?.interactive?.list_reply?.title ?? '').trim().slice(0, 2000);
  const captured = await require('../../helper/pipeline/leadPipeline').captureBotInbound({ uid, origin, chatId, senderMobile: message.senderMobile, senderName: message.senderName, normalizedMessage: message, providerMessageId: message.metaChatId, timestamp: message.timestamp, pool });
  if (!captured.leadId) throw Object.assign(new Error('BOT_LEAD_NOT_CAPTURED'), { code: 'BOT_LEAD_NOT_CAPTURED' });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const uidHash = crypto.createHash('sha256').update(uid).digest('hex');
    const [[lead]] = await db.query('SELECT id,contact_id,learner_name,qualification_data FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=? FOR UPDATE', [uidHash, uid, captured.leadId]);
    if (!lead) throw Object.assign(new Error('BOT_LEAD_NOT_FOUND'), { code: 'BOT_LEAD_NOT_FOUND' });
    const qualification = parse(lead.qualification_data);
    const prior = qualification.botCapture || {};
    const inboundKey = context.fingerprint([profile.channelKind, profile.channelRef, chatId, message.metaChatId]).slice(0, 24);
    const previousKeys = Array.isArray(prior.inboundKeys) ? prior.inboundKeys : [];
    const alreadyCaptured = previousKeys.includes(inboundKey);
    const retrieval = context.retrieveContext({ facts, message: text });
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
    const name = customerName(text, (prior.waitingFor === 'name' || guidedState.greeted === true) && !courses.length);
    const details = qualificationFromText(text);
    if (!alreadyCaptured && courses.length) qualification.courseInterest = courses.map(item => item.name).join('; ').slice(0, 180);
    else if (!alreadyCaptured && details.courseInterest) qualification.courseInterest = details.courseInterest;
    for (const key of ['preferredSchedule', 'learningGoal']) if (!alreadyCaptured && details[key]) qualification[key] = details[key];
    let meta = { ...prior };
    if (!alreadyCaptured && name) meta.nameConfirmed = true;
    if (!alreadyCaptured && courses.length) meta.courseConfirmed = true;
    if (!alreadyCaptured && /^(?:reset bot|restart bot|إعادة ضبط الروبوت)$/iu.test(text)) meta = { ...meta, waitingFor: null, nameAsked: false, courseAsked: false };
    if (!alreadyCaptured) meta.inboundKeys = [...previousKeys, inboundKey].slice(-25);
    const language = context.languageFor(text);
    const questionKey = !meta.nameConfirmed && !meta.nameAsked ? 'collectNameMessage' : !qualification.courseInterest && !meta.courseAsked ? 'collectCourseMessage' : null;
    qualification.botCapture = meta;
    const changed = !alreadyCaptured && (JSON.stringify(qualification) !== JSON.stringify(parse(lead.qualification_data)) || (name && name !== lead.learner_name) || !!details.email);
    if (changed) {
      await db.query('UPDATE pipeline_leads SET qualification_data=?,learner_name=COALESCE(?,learner_name),contact_name=COALESCE(?,contact_name),last_activity_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND uid=? AND id=?', [JSON.stringify(qualification), name, name, uidHash, uid, lead.id]);
      if (lead.contact_id && (name || details.email)) await db.query('UPDATE pipeline_contacts SET display_name=COALESCE(?,display_name),normalized_email=COALESCE(?,normalized_email) WHERE uid_hash=? AND uid=? AND id=?', [name, details.email || null, uidHash, uid, lead.contact_id]);
      const old = parse(lead.qualification_data);
      const fields = [...(name && (name !== lead.learner_name || !prior.nameConfirmed) ? ['learnerName'] : []), ...['courseInterest','preferredSchedule','learningGoal'].filter(key => qualification[key] !== old[key]), ...(details.email ? ['email'] : [])];
      if (fields.length) await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,activity_type,summary,details,created_at) VALUES (?,?,'system','lead_updated','Bot saved learner enquiry details',?,UTC_TIMESTAMP(3))`, [uidHash, lead.id, JSON.stringify({ origin: 'chatbot', profileId: profile.id, fields, ...(fields.includes('courseInterest') ? { courseInterest: qualification.courseInterest } : {}) })]);
    }
    await db.commit();
    const simpleName = name && ['','my name is ','my name s ','call me ','اسمي ','انا اسمي '].some(prefix => context.normalized(text) === prefix + context.normalized(name));
    return { leadId: lead.id, uidHash, facts, questionKey, language, nameCaptured: !!name, nameOnly: !!simpleName && !retrieval.explicitCourses, courseInterest: qualification.courseInterest || null };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

async function captureGenericLead(pool, { ctx, profile, uid, chatId, origin, message }) {
  if (!genericCaptureEnabled(ctx) || profile?.config?.captureLeads !== true
    || !recipientAllowed(profile.config, message?.senderMobile)) return null;
  const captured = await require('../../helper/pipeline/leadPipeline').captureBotInbound({
    uid, origin, chatId, senderMobile: message.senderMobile, senderName: message.senderName,
    normalizedMessage: message, providerMessageId: message.metaChatId, timestamp: message.timestamp, pool,
  });
  if (captured.skipped || !captured.leadId) throw Object.assign(new Error('BOT_LEAD_NOT_CAPTURED'), { code: 'BOT_LEAD_NOT_CAPTURED' });
  return { leadId: captured.leadId, duplicate: captured.duplicate === true };
}

function addQuestion(reply, info, config, defaults) {
  if (!info?.questionKey) return reply;
  const text = config?.guidedContent?.messages?.[info.questionKey]?.[info.language] || defaults?.messages?.[info.questionKey]?.[info.language];
  if (!text) return reply;
  return reply.replace(/[^\n.!?؟]*[?؟]\s*$/u, '').trim() + '\n\n' + text;
}

async function markAsked(pool, info, uid) {
  if (!info?.questionKey) return;
  const key = info.questionKey === 'collectNameMessage' ? 'name' : 'course';
  const db = await pool.getConnection();
  try {
    await db.query(`UPDATE pipeline_leads SET qualification_data=JSON_SET(COALESCE(qualification_data,JSON_OBJECT()),?,true,'$.botCapture.waitingFor',?) WHERE uid_hash=? AND uid=? AND id=?`, ['$.botCapture.' + key + 'Asked', key, info.uidHash, uid, info.leadId]);
  } finally { db.release(); }
}
module.exports = { captureLead, captureGenericLead, genericCaptureEnabled, usesTrainingLeadCapture, customerName, qualificationFromText, addQuestion, markAsked };
