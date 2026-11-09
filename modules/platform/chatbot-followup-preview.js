'use strict';

const { createHash } = require('node:crypto');
const { getDomainPack } = require('./chatbot-domain-packs');
const { languageFor, retrieveContext, normalized, courseFromVerifiedReferral } = require('./chatbot-business-context');
const { acknowledgement, startPreference } = require('./chatbot-admissions-intake');
const { variants, render } = require('./chatbot-followup-library');

const DAY = 86400000;
const QATAR_OFFSET = 3 * 3600000;
const EARLY = new Set(['new', 'interested', 'contacted', 'qualified']);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const outboundFollowup = /checking in|just (?:checking|following) up|still (?:interested|looking|planning)|any updates|friendly reminder|أتابع معك|هل ما زلت مهتما|للتذكير/iu;
const optOut = /^(?:stop(?: course updates)?|unsubscribe|(?:do not|don['’]?t) (?:contact|message|call)(?: me)?|not interested(?: anymore)?|please stop|إلغاء|الغاء|توقف|غير مهتم)[.،!\s]*$/iu;
const cues = {
  F02: /\b(?:fees?|price|cost|how much|payment)\b|رسوم|سعر|تكلفة/iu,
  F03: /\b(?:how long|duration|weeks)\b|مدة|مدتها/iu,
  F04: /\b(?:batch|start|intake|availability)\b|موعد|الدفعة|تبدأ/iu,
  F05: /\b(?:weekends?|evenings?|after work|schedule|time)\b|دوام|مساء|جدول/iu,
  F06: /\b(?:online|hybrid|in.person|classroom)\b|حضوري|عن بعد/iu,
  F07: /\b(?:location|address|where|map)\b|مكان|عنوان|أين|موقع/iu,
  F08: /\b(?:curriculum|topics|modules|practical|what will i learn)\b|محاور|محتوى|عملي/iu,
  F09: /\b(?:beginner|experience|level|prerequisites)\b|خبرة|مستوى|مبتدئ/iu,
  F10: /\b(?:certificate|accreditation|recognized)\b|شهادة|اعتماد/iu,
  F12: /\b(?:apply|application|register|registration)\b|تسجيل|نموذج/iu,
  F13: /\b(?:compare|difference|which course)\b|مقارنة|الفرق/iu,
};

const parse = value => {
  try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; }
};
const sqlDate = value => new Date(value).toISOString().slice(0, 23).replace('T', ' ');
const utc = value => Date.parse(String(value || '').replace(' ', 'T') + 'Z');
const epoch = row => {
  const value = Number(row.timestamp);
  return value > 1e9 ? (value > 1e12 ? value : value * 1000) : Number(row.created_epoch) * 1000;
};
const qatarDay = value => new Date(value + QATAR_OFFSET).toISOString().slice(0, 10);
const since = () => process.env.SALEMAX_CHATBOT_FOLLOWUP_PREVIEW_SINCE || '';
const enabled = tenant => require('./chatbot-mockup').enabled(tenant) && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(since());

function inReviewHours(value) {
  const local = new Date(value + QATAR_OFFSET);
  if (local.getUTCHours() >= 18) local.setUTCDate(local.getUTCDate() + 1);
  else if (local.getUTCHours() >= 9) return value;
  local.setUTCHours(9, 0, 0, 0);
  return local.getTime() - QATAR_OFFSET;
}

function schedule(first, last) {
  const anchor = Math.max(first, last);
  return { two: inReviewHours(anchor + 2 * DAY), seven: inReviewHours(anchor + 7 * DAY) };
}

function textOf(row) {
  const body = parse(row.msgContext);
  return String(body?.text?.body ?? body?.button?.text ?? body?.interactive?.button_reply?.title
    ?? body?.interactive?.list_reply?.title ?? body?.image?.caption ?? body?.document?.caption ?? '').slice(0, 1200).trim();
}

function classify({ row, messages, course, now = Date.now() }) {
  const inbound = messages.filter(m => m.route === 'INCOMING' && !['reaction','status','protocol'].includes(m.type));
  const last = inbound.at(-1);
  if (!last) return { status: 'skipped', reason: 'NO_CUSTOMER_MESSAGE' };
  const lastAt = epoch(last);
  if (!Number.isFinite(lastAt) || !Number.isFinite(utc(row.first_at))) return { status: 'review', reason: 'NO_CUSTOMER_MESSAGE' };
  const times = schedule(utc(row.first_at), lastAt);
  const result = { lastAt, ...times };
  const status = (value, reason) => ({ ...result, status: value, reason });
  if (inbound.some(m => optOut.test(textOf(m)))) return status('skipped', 'OPT_OUT');
  if (row.status !== 'open' || !EARLY.has(row.stage_key) || row.progressed) return status('skipped', 'LEAD_PROGRESSED');
  if (row.automation_paused || row.staff_task) return status('skipped', 'STAFF_OWNS_LEAD');
  if (row.prior_reason === 'CUSTOMER_REPLIED' || (row.prior_draft && lastAt > utc(row.prior_last) && !acknowledgement(textOf(last), 'en'))) {
    return status('skipped', 'CUSTOMER_REPLIED');
  }
  const handled = messages.some(m => m.route === 'OUTGOING' && epoch(m) >= lastAt
    && !['bot','ai','automation','chatbot'].includes(String(m.sentBy || '').toLowerCase())
    && (epoch(m) - lastAt > 3 * 3600000 || outboundFollowup.test(textOf(m))));
  if (handled || row.staff_followup) return status('skipped', 'STAFF_FOLLOWED_UP');
  if (!course) return status('review', 'COURSE_UNCLEAR');
  if (!textOf(last)) return status('review', 'REVIEW_MEDIA');
  return now < times.two ? status('scheduled', 'WAITING_FOR_SILENCE') : status('ready', 'QUIET_ENQUIRY');
}

async function candidates(db, tenant, uid, ids = null) {
  const hash = createHash('sha256').update(uid).digest('hex');
  const selection = ids
    ? ' AND l.id IN (?)'
    : ` AND ((p.id IS NOT NULL AND p.checked_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE))
             OR (p.id IS NULL AND l.status='open' AND l.first_inbound_at>=GREATEST(?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY))))
      ORDER BY p.checked_at IS NOT NULL,p.checked_at,l.first_inbound_at,l.id LIMIT 20`;
  const [rows] = await db.query(`SELECT l.id,l.status,l.stage_key,l.automation_paused,l.qualification_data,
    CAST(l.first_inbound_at AS CHAR) AS first_at,
    p.source,p.course_name,p.reason AS prior_reason,p.first_draft AS prior_draft,p.second_draft AS prior_second,
    p.draft_source,CAST(p.last_customer_at AS CHAR) AS prior_last,
    EXISTS(SELECT 1 FROM sx_training_form_submissions f WHERE f.tenant_id=? AND BINARY f.lead_id=BINARY l.id)
      OR EXISTS(SELECT 1 FROM sx_training_enrollments e WHERE e.tenant_id=? AND BINARY e.lead_id=BINARY l.id) AS progressed,
    EXISTS(SELECT 1 FROM sx_tasks t WHERE t.tenant_id=? AND BINARY t.uid_hash=BINARY l.uid_hash
      AND BINARY t.lead_id=BINARY l.id AND t.deleted_at IS NULL AND t.task_type='lead_follow_up'
      AND t.status IN ('open','in_progress','blocked')) AS staff_task
    FROM pipeline_leads l LEFT JOIN sx_chatbot_followup_previews p ON p.tenant_id=? AND BINARY p.lead_id=BINARY l.id
    WHERE l.uid_hash=? AND l.uid=? AND l.first_inbound_at IS NOT NULL AND l.primary_origin IN ('qr','meta')${selection}`,
  [tenant, tenant, tenant, tenant, hash, uid, ids || since()]);
  return rows;
}

async function evidence(db, uid, row, facts) {
  const hash = createHash('sha256').update(uid).digest('hex');
  const [messages] = await db.query(`SELECT m.type,m.route,m.msgContext,m.timestamp,m.sentBy,UNIX_TIMESTAMP(m.createdAt) AS created_epoch,m.id
    FROM pipeline_conversations c JOIN beta_conversation m ON m.uid=? COLLATE utf8mb4_unicode_ci
      AND m.chat_id=c.chat_id COLLATE utf8mb4_unicode_ci AND BINARY m.origin=BINARY c.origin
    WHERE c.uid_hash=? AND c.lead_id=? AND LEFT(c.chat_id,8)<>'qrgroup_' AND m.route IN ('INCOMING','OUTGOING')
    ORDER BY m.id DESC LIMIT 40`, [uid, hash, row.id]);
  messages.sort((a, b) => epoch(a) - epoch(b) || a.id - b.id);
  const inbound = messages.filter(m => m.route === 'INCOMING' && !['reaction','status','protocol'].includes(m.type));
  const last = inbound.at(-1);
  if (last && Number.isFinite(epoch(last))) {
    const [[signal]] = await db.query(`SELECT EXISTS(SELECT 1 FROM pipeline_activity
      WHERE uid_hash=? AND lead_id=? AND actor_type IN ('agent','user') AND created_at>=?
        AND (activity_type IN ('contact_outcome','call_logged','follow_up_completed')
          OR (activity_type='agent_message_sent' AND created_at>?))) AS followed`,
    [hash, row.id, sqlDate(epoch(last)), sqlDate(epoch(last) + 3 * 3600000)]);
    row.staff_followup = signal.followed;
  }
  const inboundTexts = inbound.map(textOf).filter(Boolean);
  const match = text => {
    if (!text) return null;
    const context = retrieveContext({ facts, message: text });
    return context.explicitCourses === 1 ? context.selectedCourseCode : null;
  };
  const courses = new Set(inboundTexts.map(match).filter(Boolean));
  const saved = match(String(parse(row.qualification_data).courseInterest || ''));
  let inferred = null;
  if (!courses.size && !saved && inboundTexts.some(text => /more (?:info|details)|interested|معلومات|تفاصيل|مهتم/iu.test(text))) {
    const [ads] = await db.query(`SELECT source_type,source_id,ctwa_clid,headline,body,source_url FROM pipeline_attributions WHERE uid_hash=? AND lead_id=? AND is_verified_ad=1
      ORDER BY event_at DESC LIMIT 3`, [hash, row.id]);
    const referrals = [...inbound.map(item => parse(item.msgContext).referral).filter(Boolean), ...ads];
    const adMatches = new Set(referrals.map(item => courseFromVerifiedReferral(facts, item)?.code).filter(Boolean));
    if (adMatches.size === 1) inferred = [...adMatches][0];
  }
  const code = courses.size === 1 ? [...courses][0] : courses.size === 0 ? (saved || inferred) : null;
  const course = facts.find(item => item.code === code);
  return { messages, inboundTexts, course };
}

function summary(messages, inboundTexts) {
  const inbound = inboundTexts.slice().reverse();
  const replies = messages.filter(m => m.route === 'OUTGOING');
  const asked = [...new Set(inbound.flatMap(text => Object.keys(cues).filter(id => cues[id].test(text))))];
  const answered = Object.keys(cues).filter(id => replies.some(row => cues[id].test(textOf(row))));
  const shared = replies.some(row => row.type === 'document');
  const outstanding = asked.filter(id => !answered.includes(id));
  const first = [...new Set([...outstanding, ...(shared ? ['F11'] : []), ...asked, 'F01','F04'])];
  const second = [...new Set(['F14','F15', ...outstanding, 'F04'])];
  const topics = text => Object.keys(cues).filter(id => cues[id].test(text));
  const recentTopics = messages.slice(-6).map(row => ({ role: row.route === 'INCOMING' ? 'customer' : 'staff', topics: topics(textOf(row)) }));
  const start = inbound.map(text => startPreference(text)?.window).find(Boolean) || null;
  return { asked, answered, first, second, recentTopics, preferredStart: start,
    language: languageFor(inbound[0] || '', { language: languageFor(inboundTexts.join(' '), {}) }) };
}

function validatedDraftPair(value, name, language) {
  const pair = parse(value);
  const texts = [pair.day2, pair.day7];
  if (texts.some(text => typeof text !== 'string' || text.trim().length < 25 || text.length > 320
    || text.split('{course}').length !== 2 || (text.match(/[?؟]/gu) || []).length !== 1
    || /[\p{N}<>\r\n]|https?:|www\.|\b(?:guaranteed?|discount|booked|reserved|limited seats|last chance|you clicked)\b|مضمون|خصم|تم حجز/iu.test(text)
    || (language === 'ar' && !/[\u0600-\u06ff]/u.test(text)))
    || normalized(texts[0]) === normalized(texts[1])) return null;
  return { first: texts[0].trim().replace('{course}', () => name), second: texts[1].trim().replace('{course}', () => name) };
}

async function draftPair(pool, tenant, info, course, aiAllowed) {
  const name = info.language === 'ar' ? course.nameAr || course.nameEn : course.nameEn;
  const firstId = info.first[0], secondId = info.second.find(id => id !== firstId);
  const fallback = { first: render(firstId, name, info.language), second: render(secondId, name, info.language), source: 'library' };
  if (!aiAllowed) return fallback;
  const settingsApi = require('./tenant-ai-settings');
  let reservation, settings, response;
  try {
    settings = await settingsApi.forRuntime(pool, tenant);
    if (!settings) return fallback;
    reservation = await settingsApi.reserveTokens(pool, tenant, settings.daily_token_limit, 1800);
    response = await require('./chatbot-provider').generate({
      provider: settings.provider, model: settings.model, apiKey: settings.apiKey, maxOutputTokens: 450,
      system: 'Write two distinct, soft WhatsApp drafts from Pro Catalyst Training Center in the requested language. Use one short question in each, and the exact placeholder {course} once in each. Day 2 should address an unresolved topic from the summary. Day 7 should offer a different low-pressure next step. Use the examples only for tone. Use no links, digits, factual promises, discounts, names of other courses, or references to clicking an ad. Output JSON with can_answer true, confidence 0 to 1, and reply as a JSON-encoded string containing day2 and day7 fields.',
      user: JSON.stringify({ ...info, intents: Object.fromEntries(Object.entries(variants).map(([id, value]) => [id, value[0]])),
        examples: [render(firstId, '{course}', info.language), render(secondId, '{course}', info.language)] }),
    });
    const pair = response.canAnswer && response.confidence >= 0.65 && validatedDraftPair(response.reply, name, info.language);
    if (pair) return { ...pair, source: 'ai_selection' };
  } catch (error) {
    response = error.usage;
  } finally {
    if (reservation) await settingsApi.settleTokens(pool, tenant, reservation,
      response ? (response.inputTokens || 0) + (response.outputTokens || 0) : null,
      { ...response, provider: settings.provider, model: settings.model }).catch(() => {});
  }
  return fallback;
}

async function save(db, tenant, row, result, drafts) {
  await db.query(`INSERT INTO sx_chatbot_followup_previews
    (tenant_id,lead_id,source,status,course_name,reason,last_customer_at,day_two_at,day_seven_at,
     first_draft,second_draft,draft_source,checked_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE source=VALUES(source),status=VALUES(status),course_name=VALUES(course_name),reason=VALUES(reason),
      last_customer_at=VALUES(last_customer_at),day_two_at=VALUES(day_two_at),day_seven_at=VALUES(day_seven_at),
      first_draft=VALUES(first_draft),second_draft=VALUES(second_draft),draft_source=VALUES(draft_source),checked_at=VALUES(checked_at)`,
  [tenant, row.id, row.source || 'scheduled', result.status, result.courseName || null, result.reason,
    result.lastAt ? sqlDate(result.lastAt) : null, result.two ? sqlDate(result.two) : null,
    result.seven ? sqlDate(result.seven) : null, drafts?.first || null, drafts?.second || null, drafts?.source || null]);
}

async function locked(pool, tenant, work, seconds = 0) {
  const db = await pool.getConnection();
  const key = 'chatbot-followup-preview:' + tenant;
  try {
    const [[lock]] = await db.query('SELECT GET_LOCK(?,?) AS held', [key, seconds]);
    if (Number(lock.held) !== 1) return null;
    try { return await work(db); }
    finally { await db.query('SELECT RELEASE_LOCK(?)', [key]); }
  } finally { db.release(); }
}

async function owner(db, tenant) {
  const uid = await require('./chatbot-owner-uid').legacyOwnerUidForTenant(db, tenant);
  if (!require('./chatbot-mockup').ownsInbox(uid, 'qr')) throw Object.assign(Error('FOLLOWUP_OWNER_MISMATCH'), { code: 'FOLLOWUP_OWNER_MISMATCH' });
  return uid;
}

const loadFacts = (db, tenant) => getDomainPack('training_center', 1).loadFacts({ db, tenantId: tenant, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN });

async function tick(pool, tenant) {
  if (!enabled(tenant)) return;
  return locked(pool, tenant, async db => {
    const uid = await owner(db, tenant);
    await db.query(`DELETE FROM sx_chatbot_followup_previews WHERE tenant_id=?
      AND created_at < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY) ORDER BY id LIMIT 200`, [tenant]);
    const rows = await candidates(db, tenant, uid);
    if (!rows.length) return 0;
    const facts = await loadFacts(db, tenant);
    const [[profile]] = await db.query("SELECT config FROM sx_chatbot_profiles WHERE tenant_id=? AND status='live' ORDER BY revision DESC LIMIT 1", [tenant]);
    const aiAllowed = parse(profile?.config).aiDataProcessingConfirmed === true;
    for (const row of rows) {
      const { messages, inboundTexts, course: matched } = await evidence(db, uid, row, facts);
      const course = row.source === 'reviewed' ? facts.find(item => item.nameEn === row.course_name) : matched;
      const result = classify({ row, messages, course });
      result.courseName = course?.nameEn || row.course_name;
      let drafts;
      if (row.prior_draft && (row.source === 'reviewed' || result.lastAt === utc(row.prior_last))) {
        drafts = { first: row.prior_draft, second: row.prior_second, source: row.draft_source };
      } else if (result.status === 'ready') {
        const info = summary(messages, inboundTexts);
        drafts = await draftPair(pool, tenant, info, course, aiAllowed);
      }
      await save(db, tenant, row, result, drafts);
    }
    return rows.length;
  });
}

function start(pool) {
  const tenant = process.env.SALEMAX_CHATBOT_MOCKUP_TENANT_ID;
  if (!enabled(tenant)) return;
  const run = async () => {
    try { await tick(pool, tenant); }
    catch (error) { console.warn('[follow-up preview] scan failed', /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'FOLLOWUP_SCAN_FAILED'); }
    finally { setTimeout(run, 60000).unref(); }
  };
  setTimeout(run, 15000).unref();
}

async function seedPilot(pool, tenant, entries) {
  if (!enabled(tenant) || !Array.isArray(entries) || entries.length !== 20 ||
    new Set(entries.map(item => item.id)).size !== 20 || entries.some(item =>
      !uuid.test(item.id) || !/^\d{4}-\d{2}-\d{2}$/.test(item.lastDay) ||
      [item.course, item.first, item.second].some(value => typeof value !== 'string' || !value.trim() || value.length > 500))) {
    throw Error('FOLLOWUP_INVALID_PILOT');
  }
  const count = await locked(pool, tenant, async db => {
    const uid = await owner(db, tenant);
    const rows = await candidates(db, tenant, uid, entries.map(item => item.id));
    if (rows.length !== entries.length) throw Error('FOLLOWUP_PILOT_SCOPE_MISMATCH');
    const facts = await loadFacts(db, tenant);
    await db.beginTransaction();
    try {
      for (const entry of entries.slice().reverse()) {
        const row = rows.find(item => item.id === entry.id);
        const course = facts.find(item => item.nameEn === entry.course);
        if (!course) throw Error('FOLLOWUP_PILOT_COURSE_UNAVAILABLE');
        const { messages } = await evidence(db, uid, row, facts);
        const result = classify({ row, messages, course });
        if (!result.lastAt || qatarDay(result.lastAt) !== entry.lastDay) {
          result.status = 'skipped';
          result.reason = 'CUSTOMER_REPLIED';
        }
        await save(db, tenant, { ...row, source: 'reviewed' }, { ...result, courseName: course.nameEn },
          { first: entry.first, second: entry.second, source: 'reviewed' });
      }
      await db.commit();
      return rows.length;
    } catch (error) { await db.rollback(); throw error; }
  }, 15);
  if (count === null) throw Error('FOLLOWUP_PILOT_LOCK_BUSY');
  return count;
}

async function list(pool, tenant, before, source = '') {
  const uid = await owner(pool, tenant);
  const hash = createHash('sha256').update(uid).digest('hex');
  const [rows] = await pool.query(`SELECT CAST(p.id AS CHAR) AS id,p.lead_id AS leadId,p.course_name AS course,p.status,p.reason,
    p.source,p.draft_source AS draftSource,COALESCE(l.learner_name,l.contact_name) AS label,
    (SELECT c.chat_id FROM pipeline_conversations c
      WHERE c.uid_hash=l.uid_hash AND c.lead_id=l.id AND c.origin IN ('qr','meta')
        AND c.chat_id<>'' AND LEFT(c.chat_id,8)<>'qrgroup_'
        AND EXISTS(SELECT 1 FROM beta_chats b WHERE b.uid=l.uid COLLATE utf8mb4_unicode_ci
          AND b.chat_id=c.chat_id COLLATE utf8mb4_unicode_ci AND BINARY b.origin=BINARY c.origin)
      ORDER BY c.last_inbound_at DESC,c.id DESC LIMIT 1) AS chatId,
    CAST(p.last_customer_at AS CHAR) AS lastCustomerAt,CAST(p.day_two_at AS CHAR) AS dayTwoAt,
    CAST(p.day_seven_at AS CHAR) AS daySevenAt,
    CASE WHEN p.status IN ('ready','review') THEN p.first_draft END AS firstDraft,
    CASE WHEN p.status IN ('ready','review') THEN p.second_draft END AS secondDraft
    FROM sx_chatbot_followup_previews p JOIN pipeline_leads l ON BINARY l.id=BINARY p.lead_id AND l.uid_hash=? AND l.uid=?
    WHERE p.tenant_id=? AND (?='' OR p.source=?) AND (? IS NULL OR p.id<?)
    ORDER BY p.id DESC LIMIT 31`, [hash, uid, tenant, source, source, before, before]);
  const items = rows.slice(0, 30);
  return { items, next: rows.length > 30 ? items.at(-1).id : null };
}

module.exports = { enabled, start, tick, seedPilot, list, classify, schedule, summary, validatedDraftPair };
