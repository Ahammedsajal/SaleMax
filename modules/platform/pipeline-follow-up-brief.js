'use strict';

const crypto = require('node:crypto');
const leadFilters = require('../../helper/pipeline/lead-filters');

const HOT_INTENT = /\b(?:fee|fees|price|cost|how much|payment|register|registration|enrol|enroll|apply|start now|start date|batch|schedule|seat|booking|call me|contact me|i want|i am interested|interested in|please send|send me|share the details)\b|رسوم|السعر|كم السعر|التسجيل|سجل|مهتم|أريد|ابغى|متى تبدأ|الدفعة|موعد|اتصل بي|أرسل/iu;
const WARM_INTENT = /\b(?:course|class|training|information|details|available|online|weekend|duration|location|certificate|what|when|which|tell me more)\b|دورة|كورس|تدريب|معلومات|تفاصيل|متاح|أونلاين|المدة|شهادة|متى|أين/iu;
const OPT_OUT = /^(?:stop(?: (?:course )?updates?| follow[- ]?ups?)?|unsubscribe|(?:do not|don['’]?t) (?:contact|message|call|send|follow up)(?: me)?|no more (?:messages|follow[- ]?ups)|not interested(?: anymore)?|please stop|إلغاء|الغاء|توقف|غير مهتم)[.،!\s]*$|\b(?:i am|i'm|we are|we're)?\s*not interested(?: anymore)?\b|\b(?:do not|don['’]?t)\s+(?:contact|message|call|follow up)\s+me\b|لا\s*(?:تراسل|ترسل|تتواصل|تتابع)(?:ني|وا|وا معي)?|غير\s+مهتم/iu;
const BOT_SENDER = /^(?:bot|ai|automation|chatbot|system|campaign|follow[-_ ]?up|pro catalyst)$/iu;
const NON_TEXT_TYPES = new Set(['reaction', 'status', 'protocol']);
const MAX_MESSAGE_ROWS = 100000;

function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
function uidHash(uid) { return crypto.createHash('sha256').update(String(uid), 'utf8').digest('hex'); }
function localDate(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
function messageBody(row) {
  if (row?.textBody !== undefined && row?.textBody !== null) return String(row.textBody || '').replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 1000);
  let context = row?.msgContext;
  if (typeof context === 'string') { try { context = JSON.parse(context); } catch { context = {}; } }
  context = context && typeof context === 'object' ? context : {};
  const value = context.text?.body ?? context.button?.text ?? context.interactive?.button_reply?.title
    ?? context.interactive?.list_reply?.title ?? context.image?.caption ?? context.document?.caption ?? context.video?.caption ?? '';
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 1000);
}
function messageTime(row) {
  const timestamp = Number(row?.timestamp);
  if (timestamp > 1e12) return timestamp;
  if (timestamp > 1e9) return timestamp * 1000;
  const created = row?.createdAt instanceof Date ? row.createdAt.getTime() : Date.parse(String(row?.createdAt || ''));
  if (Number.isFinite(created)) return created;
  return 0;
}
function messageAfter(candidate, reference) {
  if (!candidate || !reference) return false;
  const candidateAt = messageTime(candidate), referenceAt = messageTime(reference);
  if (candidateAt !== referenceAt) return candidateAt > referenceAt;
  const candidateId = Number(candidate.id), referenceId = Number(reference.id);
  return Number.isFinite(candidateId) && Number.isFinite(referenceId) && candidateId > referenceId;
}
function classifyInbound(messages) {
  const inbound = messages.filter(row => row.route === 'INCOMING' && !NON_TEXT_TYPES.has(String(row.type || '').toLowerCase()));
  if (!inbound.length) return null;
  const allText = inbound.map(messageBody).filter(Boolean).join('\n');
  const latest = inbound.reduce((best, row) => !best || messageTime(row) >= messageTime(best) ? row : best, null);
  const latestText = messageBody(latest);
  const optedOut = inbound.some(row => OPT_OUT.test(messageBody(row)));
  const high = HOT_INTENT.test(allText);
  const warm = WARM_INTENT.test(allText);
  return {
    inbound,
    latest,
    latestText,
    optedOut,
    signal: high ? 'high' : warm ? 'warm' : 'review',
    evidence: [
      high ? 'Buying-intent terms found' : null,
      warm ? 'Course-enquiry terms found' : null,
      HOT_INTENT.test(latestText) ? 'Latest customer message is actionable' : null,
    ].filter(Boolean),
  };
}
function assessLead(lead, messages, now = Date.now()) {
  const inbound = classifyInbound(messages);
  if (!inbound) return null;
  const outbound = messages.filter(row => row.route === 'OUTGOING'
    && !NON_TEXT_TYPES.has(String(row.type || '').toLowerCase()));
  const staffOutbound = outbound.filter(row => !BOT_SENDER.test(String(row.sentBy || '').trim()));
  const latestOutbound = outbound.reduce((best, row) => !best || messageTime(row) >= messageTime(best) ? row : best, null);
  const latestStaffOutbound = staffOutbound.reduce((best, row) => !best || messageTime(row) >= messageTime(best) ? row : best, null);
  const latestInboundAt = messageTime(inbound.latest);
  if (lead.status !== 'open' || latestInboundAt <= 0 || (latestStaffOutbound && !messageAfter(inbound.latest, latestStaffOutbound)) || inbound.optedOut) return null;
  const hoursWaiting = Math.max(0, (now - latestInboundAt) / 3600000);
  const signal = inbound.signal;
  return {
    leadId: String(lead.id),
    chatId: String(inbound.latest.chatId || lead.chat_id || ''),
    origin: String(inbound.latest.origin || lead.primary_origin || ''),
    customerName: String(lead.learner_name || lead.contact_name || lead.title || 'Unnamed lead').replace(/[\r\n\t]+/gu, ' ').trim(),
    title: String(lead.title || '').replace(/[\r\n\t]+/gu, ' ').trim(),
    stage: String(lead.stage_key || 'new'),
    ownerAgentId: lead.owner_agent_id == null ? null : Number(lead.owner_agent_id),
    ownerName: lead.owner_agent_id == null ? 'Manager / unassigned' : (lead.owner_name || 'Assigned staff'),
    priority: signal,
    businessMessageEverSent: outbound.length > 0,
    automatedReplyAfterLatestCustomer: messageAfter(latestOutbound, inbound.latest)
      && BOT_SENDER.test(String(latestOutbound?.sentBy || '').trim()),
    evidence: inbound.evidence,
    latestCustomerMessage: inbound.latestText,
    lastCustomerAt: new Date(latestInboundAt).toISOString(),
    hoursWaiting: Math.round(hoursWaiting),
    daysWaiting: Math.floor(hoursWaiting / 24),
    suggestedNextStep: signal === 'high' ? 'Review the chat and reply today.' : signal === 'warm' ? 'Confirm course details and the next available start date.' : 'Review the recent chat and decide whether to follow up.',
  };
}

function teamScope(role, agentId, scopeAgentIds) {
  if (role === 'agent') {
    if (!Number.isSafeInteger(Number(agentId)) || Number(agentId) < 1) fail('INVALID_REPORT_ACTOR', 403);
    return { sql: ' AND l.owner_agent_id=?', args: [Number(agentId)] };
  }
  if (['manager', 'team_leader'].includes(role) && Array.isArray(scopeAgentIds)) {
    return scopeAgentIds.length ? { sql: ' AND l.owner_agent_id IN (?)', args: [scopeAgentIds.map(Number)] } : { sql: ' AND 1=0', args: [] };
  }
  return { sql: '', args: [] };
}
function shapeBrief(items, { date, timezone = 'Asia/Qatar', needsReview = 0, unassigned = null,
  noBusinessMessage = 0, automatedReplyAwaitingStaff = 0, includeItems = true } = {}) {
  const high = items.filter(item => item.priority === 'high');
  const warm = items.filter(item => item.priority === 'warm');
  const review = items.filter(item => item.priority === 'review');
  const comparator = (a, b) => Number(b.daysWaiting >= 3) - Number(a.daysWaiting >= 3)
    || ({ high: 0, warm: 1, review: 2 }[a.priority] - { high: 0, warm: 1, review: 2 }[b.priority])
    || b.hoursWaiting - a.hoursWaiting;
  const sorted = items.slice().sort(comparator);
  return {
    date: date || localDate(timezone),
    timezone,
    asOf: new Date().toISOString(),
    summary: {
      total: items.length,
      unansweredOpen: items.length + (Number(needsReview) || review.length),
      highIntent: high.length,
      warmInterest: warm.length,
      needsReview: Number(needsReview) || review.length,
      waiting72Hours: items.filter(item => item.daysWaiting >= 3).length,
      unassigned: unassigned === null ? items.filter(item => item.ownerAgentId == null).length : Number(unassigned) || 0,
      noBusinessMessage: Number(noBusinessMessage) || 0,
      automatedReplyAwaitingStaff: Number(automatedReplyAwaitingStaff) || 0,
    },
    items: includeItems ? sorted.slice(0, 100) : [],
    hasMore: sorted.length > 100,
    definition: 'Open leads are included when the latest customer message is newer than every human outbound message on a linked direct QR or Meta chat. Bot messages do not count as staff follow-up. Keyword signals are rule-based and need staff review.',
  };
}

async function getBrief({ pool, uid, role = 'owner', agentId, scopeAgentIds, timezone = 'Asia/Qatar', assignment, qrInstanceId, includeItems = true, now = Date.now() }) {
  if (!pool || typeof uid !== 'string' || !uid) fail('WORKSPACE_REQUIRED', 400);
  if (!['owner', 'manager', 'team_leader', 'agent'].includes(role)) fail('PERMISSION_DENIED', 403);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('INVALID_TIMEZONE', 400); }
  const db = typeof pool.promise === 'function' ? pool.promise() : pool;
  const connection = await db.getConnection();
  try {
    const leadScope = teamScope(role, agentId, scopeAgentIds);
    const filters = leadFilters.parseLeadFilters({ assignment, qrInstanceId });
    const filterScope = leadFilters.leadFilterSql({ ...filters, alias: 'l' });
    const uidDigest = uidHash(uid);
    const [leads] = await connection.query(`SELECT l.id,l.uid,l.title,l.contact_name,l.learner_name,l.chat_id,l.primary_origin,l.stage_key,l.status,l.owner_agent_id,l.created_at,
        COALESCE(NULLIF(a.name,''),CONCAT('Agent ',a.id)) AS owner_name
      FROM pipeline_leads l LEFT JOIN agents a ON a.id=l.owner_agent_id AND a.owner_uid COLLATE utf8mb4_general_ci=l.uid COLLATE utf8mb4_general_ci
      WHERE l.uid_hash=? AND l.uid=? AND l.status='open'${leadScope.sql}${filterScope.sql}
      ORDER BY l.created_at DESC,l.id`, [uidDigest, uid, ...leadScope.args, ...filterScope.args]);
    if (!leads.length) return shapeBrief([], { timezone, includeItems });
    const leadIds = leads.map(row => String(row.id));
    const [conversations] = await connection.query(`SELECT pc.lead_id AS leadId,pc.chat_id AS chatId,pc.origin
      FROM pipeline_conversations pc JOIN pipeline_leads l ON l.uid_hash=pc.uid_hash AND l.id=pc.lead_id
      WHERE pc.uid_hash=? AND l.uid=? AND l.status='open' AND pc.lead_id IN (?)
        AND pc.origin IN ('qr','meta') AND LEFT(pc.chat_id,8)<>'qrgroup_'
      ORDER BY pc.lead_id,pc.last_inbound_at DESC`, [uidDigest, uid, leadIds]);
    if (!conversations.length) return shapeBrief([], { timezone, includeItems });
    const eventByLead = new Map(leadIds.map(id => [id, []]));
    const chatToLead = new Map();
    for (const row of conversations) {
      const key = `${row.origin}|:|${row.chatId}`;
      const ids = chatToLead.get(key) || [];
      ids.push(String(row.leadId)); chatToLead.set(key, ids);
    }
    const chatIds = [...new Set(conversations.map(row => String(row.chatId)))];
    const [messageCount] = await connection.query(`SELECT COUNT(*) AS total FROM beta_conversation bc
      WHERE bc.uid=? AND bc.chat_id IN (?) AND bc.origin IN ('qr','meta') AND LEFT(bc.chat_id,8)<>'qrgroup_'`, [uid, chatIds]);
    if (Number(messageCount[0]?.total || 0) > MAX_MESSAGE_ROWS) fail('FOLLOW_UP_HISTORY_TOO_LARGE', 503);
    const [messages] = await connection.query(`SELECT bc.chat_id AS chatId,bc.origin,bc.id,bc.type,bc.route,bc.sentBy,bc.timestamp,bc.createdAt,
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(bc.msgContext),bc.msgContext,'{}'),'$.text.body')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(bc.msgContext),bc.msgContext,'{}'),'$.button.text')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(bc.msgContext),bc.msgContext,'{}'),'$.interactive.button_reply.title')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(bc.msgContext),bc.msgContext,'{}'),'$.interactive.list_reply.title')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(bc.msgContext),bc.msgContext,'{}'),'$.image.caption')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(bc.msgContext),bc.msgContext,'{}'),'$.document.caption')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(bc.msgContext),bc.msgContext,'{}'),'$.video.caption')),''),'') AS textBody
      FROM beta_conversation bc WHERE bc.uid=? AND bc.chat_id IN (?) AND bc.origin IN ('qr','meta')
        AND LEFT(bc.chat_id,8)<>'qrgroup_' AND bc.route IN ('INCOMING','OUTGOING')
      ORDER BY bc.chat_id,bc.origin,bc.id`, [uid, chatIds]);
    for (const row of messages) {
      if (NON_TEXT_TYPES.has(String(row.type || '').toLowerCase())) continue;
      const related = chatToLead.get(`${row.origin}|:|${row.chatId}`) || [];
      const event = { ...row, at: messageTime(row) };
      for (const leadId of related) eventByLead.get(leadId)?.push(event);
    }
    const leadById = new Map(leads.map(row => [String(row.id), row]));
    const items = [];
    let needsReview = 0;
    let unassigned = 0;
    let noBusinessMessage = 0;
    let automatedReplyAwaitingStaff = 0;
    for (const [leadId, events] of eventByLead) {
      const item = assessLead(leadById.get(leadId), events, now);
      if (!item) continue;
      if (item.ownerAgentId == null) unassigned++;
      if (!item.businessMessageEverSent) noBusinessMessage++;
      if (item.automatedReplyAfterLatestCustomer) automatedReplyAwaitingStaff++;
      if (item.priority === 'review') needsReview++;
      else items.push(item);
    }
    return shapeBrief(items, { timezone, needsReview, unassigned, noBusinessMessage, automatedReplyAwaitingStaff, includeItems });
  } finally { connection.release(); }
}

module.exports = { HOT_INTENT, WARM_INTENT, OPT_OUT, BOT_SENDER, messageBody, messageTime, messageAfter, classifyInbound, assessLead, shapeBrief, getBrief, _private: { NON_TEXT_TYPES, MAX_MESSAGE_ROWS, localDate } };
