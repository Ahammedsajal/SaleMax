'use strict';

const crypto = require('node:crypto');
const followUpBrief = require('./pipeline-follow-up-brief');

const DEFAULT_TIMEZONE = 'Asia/Qatar';
const DEFAULT_SEND_TIME = '09:00';
const MAX_BATCH = 100;
const LEASE_SECONDS = 600;
const BOT_SENDER = followUpBrief.BOT_SENDER;

function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
function digest(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function poolOf(source) { return typeof source?.promise === 'function' ? source.promise() : source; }
function qatarDate(now = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function qatarTime(now = new Date(), timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}
function zonedDateTime(date, time, timezone = DEFAULT_TIMEZONE) {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(time).split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) fail('INVALID_SCHEDULE');
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const value = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
    const represented = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, 0, 0);
    guess += target - represented;
  }
  return new Date(guess);
}
function nextScheduledAt(now, time, timezone = DEFAULT_TIMEZONE) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  let date = qatarDate(current, timezone);
  let due = zonedDateTime(date, time, timezone);
  if (due <= current) {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
    due = zonedDateTime(date, time, timezone);
  }
  return due;
}
function dbDate(value) { return new Date(value).toISOString().slice(0, 23).replace('T', ' '); }
function dateOnly(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10); }
function utcMillis(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '');
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
}
function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s().-]/g, '');
  return /^\+?[1-9]\d{7,14}$/.test(phone) ? phone.replace(/^\+/, '') : null;
}
function actorContext(ctx) {
  const tenantId = String(ctx?.tenant?.id || ctx?.tenantId || '');
  const uid = String(ctx?.uid || '');
  const uidHash = String(ctx?.uidHash || (uid ? digest(uid) : ''));
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !uid || !/^[0-9a-f]{64}$/i.test(uidHash)) fail('WORKSPACE_REQUIRED', 400);
  if (ctx?.tenant?.categoryKey && ctx.tenant.categoryKey !== 'training_center') fail('CATEGORY_UNAVAILABLE', 409);
  return { tenantId, uid, uidHash, role: ctx?.role || ctx?.membership?.role || 'owner', identityId: ctx?.identity?.id || null };
}
function agentQueue(brief, agents) {
  const workload = new Map(agents.map(agent => [Number(agent.id), 0]));
  for (const item of brief.items || []) {
    const ownerId = Number(item.ownerAgentId);
    if (workload.has(ownerId)) workload.set(ownerId, workload.get(ownerId) + 1);
  }
  const candidates = (brief.items || []).filter(item => item.ownerAgentId == null && ['high', 'warm'].includes(item.priority));
  candidates.sort((a, b) => Number(b.daysWaiting >= 3) - Number(a.daysWaiting >= 3)
    || ({ high: 0, warm: 1 }[a.priority] - { high: 0, warm: 1 }[b.priority])
    || Number(b.hoursWaiting || 0) - Number(a.hoursWaiting || 0)
    || String(a.leadId).localeCompare(String(b.leadId)));
  const assignments = [];
  for (const item of candidates) {
    const agent = agents.slice().sort((a, b) => workload.get(Number(a.id)) - workload.get(Number(b.id)) || Number(a.id) - Number(b.id))[0];
    if (!agent) break;
    assignments.push({ leadId: String(item.leadId), agentId: Number(agent.id), priority: item.priority, daysWaiting: Number(item.daysWaiting || 0) });
    workload.set(Number(agent.id), workload.get(Number(agent.id)) + 1);
  }
  return assignments;
}
function recipientsByPhone(agentRows, identityRows) {
  const groups = new Map();
  const add = (row, { type, id, role, agentId = null } = {}) => {
    const phone = normalizePhone(row.phone);
    if (!phone) return false;
    const phoneHash = digest(phone);
    let group = groups.get(phoneHash);
    if (!group) {
      group = { recipientType: type, recipientId: String(id), phoneHash, roles: new Set(), agentId: null };
      groups.set(phoneHash, group);
    }
    group.roles.add(role);
    if (agentId !== null) group.agentId = Number(agentId);
    return true;
  };
  let noPhoneAgents = 0;
  for (const row of agentRows) {
    if (!add(row, { type: 'agent', id: row.id, role: 'agent', agentId: row.id })) noPhoneAgents++;
  }
  for (const row of identityRows) {
    const type = row.source_table === 'agents' ? 'agent' : 'user';
    add(row, { type, id: row.source_id, role: row.role, agentId: type === 'agent' ? row.source_id : null });
  }
  return { groups: [...groups.values()].map(group => ({ ...group, roles: [...group.roles] })), noPhoneAgents };
}
function shortDate(date) {
  const [year, month, day] = dateOnly(date).split('-').map(Number);
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
function makeDigests({ date, agents, runItems, brief, noPhoneAgents, identifiedCount = 0, existingAssigned = 0 }) {
  const assigned = runItems.filter(item => item.status === 'assigned');
  const byAgent = new Map(agents.map(agent => [Number(agent.id), { agent, newCount: 0, high: 0, warm: 0, aged: 0, total: 0 }]));
  for (const item of assigned) {
    const row = byAgent.get(Number(item.agent_id));
    if (!row) continue;
    row.newCount++;
    row.total++;
    if (item.priority === 'high') row.high++;
    if (item.priority === 'warm') row.warm++;
    if (Number(item.days_waiting) >= 3) row.aged++;
  }
  const managerRows = [...byAgent.values()].filter(row => row.newCount);
  const newCount = assigned.length;
  const high = assigned.filter(item => item.priority === 'high').length;
  const warm = assigned.filter(item => item.priority === 'warm').length;
  const aged = assigned.filter(item => Number(item.days_waiting) >= 3).length;
  const skipped = runItems.filter(item => item.status === 'skipped').length;
  const split = managerRows.map(row => `${row.agent.name || `Agent ${row.agent.id}`}: ${row.newCount}`).join(' · ') || 'No new assignments';
  const ownerText = [
    `7Network daily follow-up summary · ${shortDate(date)}`,
    `${Number(identifiedCount)} actionable leads identified · ${newCount} assigned today · ${Number(existingAssigned)} already assigned and left unchanged${skipped ? ` · ${skipped} no longer eligible` : ''}.`,
    `Assigned: ${high} high intent · ${warm} course interest · ${aged} waiting 72h+.`,
    `Team split: ${split}.`,
    `${Number(brief.summary?.needsReview || 0)} no-signal chats excluded for staff review; existing assignments were preserved.`,
    noPhoneAgents ? `${noPhoneAgents} agent(s) could not receive WhatsApp because no valid staff number is on file.` : null,
    'Open Lead Pipeline to review chats and record follow-up outcomes.',
    'https://7network.live/user?page=pipeline',
  ].filter(Boolean).join('\n');
  const messages = new Map();
  for (const row of byAgent.values()) {
    if (!row.newCount) continue;
    messages.set(Number(row.agent.id), [
      `7Network follow-up assignment · ${shortDate(date)}`,
      `${row.newCount} new leads assigned to you: ${row.high} high intent, ${row.warm} course interest; ${row.aged} have waited 72h+.`,
      'Please review each chat, contact the lead today, and record the outcome in Pipeline.',
      'https://7network.live/user?page=pipeline',
    ].join('\n'));
  }
  return { byAgent, ownerText, agentMessages: messages, counts: { assigned: newCount, high, warm, aged } };
}

async function queryRows(db, sql, args = []) { const [rows] = await db.query(sql, args); return rows; }
async function assertTrainingCenter(db, tenantId) {
  const [rows] = await queryRows(db, 'SELECT category_key,status FROM sx_tenants WHERE id=? LIMIT 1', [tenantId]);
  if (!rows) fail('WORKSPACE_NOT_FOUND', 404);
  if (rows.status !== 'active' || rows.category_key !== 'training_center') fail('CATEGORY_UNAVAILABLE', 409);
}
async function loadAgents(db, { tenantId, uid }) {
  return queryRows(db, `SELECT a.id,COALESCE(NULLIF(a.name,''),CONCAT('Agent ',a.id)) AS name,a.uid,a.mobile AS phone
    FROM agents a JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=?
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='agent' AND m.status='active'
    JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    WHERE a.owner_uid=? AND a.role='agent' AND a.is_active=1 ORDER BY a.id`, [tenantId, uid]);
}
async function loadSummaryRecipients(db, tenantId) {
  return queryRows(db, `SELECT m.role,m.identity_id,i.display_name,
      o.source_table,o.source_id,
      CASE WHEN o.source_table='user' THEN u.mobile_with_country_code ELSE a.mobile END AS phone
    FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table IN ('user','agents')
    LEFT JOIN user u ON o.source_table='user' AND u.id=CAST(o.source_id AS UNSIGNED) AND u.role='user'
    LEFT JOIN agents a ON o.source_table='agents' AND a.id=CAST(o.source_id AS UNSIGNED) AND a.is_active=1
    WHERE m.tenant_id=? AND m.status='active' AND m.role IN ('owner','manager') ORDER BY FIELD(m.role,'owner','manager'),m.created_at`, [tenantId]);
}
async function resolveWorkspace(db, uidHash) {
  const rows = await queryRows(db, 'SELECT uid FROM user WHERE LOWER(SHA2(uid,256))=? AND role=\'user\' LIMIT 2', [String(uidHash).toLowerCase()]);
  if (rows.length !== 1) fail('WORKSPACE_NOT_FOUND', 404);
  return String(rows[0].uid);
}
async function deliverySchedule(db, tenantId) {
  const [row] = await queryRows(db, `SELECT timezone,DATE_FORMAT(local_time,'%H:%i') AS local_time
    FROM sx_training_report_schedules WHERE tenant_id=? AND period='daily' LIMIT 1`, [tenantId]);
  return row
    ? { timezone: row.timezone || DEFAULT_TIMEZONE, sendTime: String(row.local_time || DEFAULT_SEND_TIME).slice(0, 5), scheduleSource: 'daily_report' }
    : { timezone: DEFAULT_TIMEZONE, sendTime: DEFAULT_SEND_TIME, scheduleSource: 'default' };
}
function settingsShape(row, latestRun = null) {
  return { enabled: Number(row?.enabled) === 1, timezone: row?.timezone || DEFAULT_TIMEZONE, sendTime: row?.send_time || DEFAULT_SEND_TIME,
    updatedAt: row?.updated_at || null, lastRun: latestRun ? { date: dateOnly(latestRun.local_date), status: latestRun.status,
      assigned: Number(latestRun.assigned_count || 0), identified: Number(latestRun.candidate_count || 0), existingAssigned: Number(latestRun.existing_assigned_count || 0), high: Number(latestRun.high_count || 0), warm: Number(latestRun.warm_count || 0),
      waiting72h: Number(latestRun.waiting_72h_count || 0), reviewExcluded: Number(latestRun.review_excluded_count || 0),
      notifications: Number(latestRun.notification_count || 0), completedAt: latestRun.completed_at || null } : null };
}
async function getSettings(source, ctx) {
  const actor = actorContext(ctx), db = poolOf(source);
  await assertTrainingCenter(db, actor.tenantId);
  const [settings] = await queryRows(db, 'SELECT * FROM sx_pipeline_followup_assignment_settings WHERE tenant_id=? AND uid_hash=? LIMIT 1', [actor.tenantId, actor.uidHash]);
  const [latest] = await queryRows(db, 'SELECT * FROM sx_pipeline_followup_assignment_runs WHERE tenant_id=? ORDER BY local_date DESC LIMIT 1', [actor.tenantId]);
  const schedule = await deliverySchedule(db, actor.tenantId);
  return { ...settingsShape(settings, latest), ...schedule };
}
async function saveSettings(source, ctx, input = {}) {
  const actor = actorContext(ctx);
  if (actor.role !== 'owner' && ctx?.membership?.role !== 'owner') fail('PERMISSION_DENIED', 403);
  if (typeof input.enabled !== 'boolean') fail('INVALID_SETTINGS');
  const db = poolOf(source), schedule = await deliverySchedule(db, actor.tenantId);
  const { timezone, sendTime } = schedule;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('INVALID_TIMEZONE'); }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) fail('INVALID_SCHEDULE');
  const conn = await db.getConnection();
  try {
    await assertTrainingCenter(db, actor.tenantId);
    await conn.beginTransaction();
    await conn.query(`INSERT INTO sx_pipeline_followup_assignment_settings(tenant_id,uid_hash,enabled,timezone,send_time,updated_by_identity_id)
      VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),timezone=VALUES(timezone),send_time=VALUES(send_time),updated_by_identity_id=VALUES(updated_by_identity_id)`,
      [actor.tenantId, actor.uidHash, input.enabled ? 1 : 0, timezone, sendTime, actor.identityId]);
    if (!input.enabled) await conn.query("UPDATE sx_pipeline_followup_assignment_outbox SET status='cancelled',last_error_code='AUTOMATION_DISABLED',lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND status='queued'", [actor.tenantId]);
    await conn.commit();
  } catch (error) { try { await conn.rollback(); } catch {} throw error; }
  finally { conn.release(); }
  return getSettings(db, { ...ctx, uidHash: actor.uidHash });
}
async function latestRun(db, tenantId, date) {
  const rows = await queryRows(db, 'SELECT * FROM sx_pipeline_followup_assignment_runs WHERE tenant_id=? AND local_date=? LIMIT 1', [tenantId, date]);
  return rows[0] || null;
}
async function buildPlan(source, config, { now = new Date(), runMode = 'manual', deliverAt = null } = {}) {
  const db = poolOf(source);
  const date = qatarDate(now, config.timezone || DEFAULT_TIMEZONE);
  const prior = await latestRun(db, config.tenantId, date);
  if (prior) return { runId: prior.id, status: prior.status, repeated: true, counts: { planned: Number(prior.planned_count), assigned: Number(prior.assigned_count), skipped: Number(prior.skipped_count), failed: Number(prior.failed_count) } };
  const brief = await followUpBrief.getBrief({ pool: db, uid: config.uid, role: 'owner', timezone: config.timezone || DEFAULT_TIMEZONE, includeItems: true, now: now.getTime() });
  if (brief.hasMore) fail('FOLLOW_UP_QUEUE_TOO_LARGE', 503);
  const agents = await loadAgents(db, { tenantId: config.tenantId, uid: config.uid });
  if (!agents.length && brief.summary.total) fail('NO_ACTIVE_AGENTS', 409);
  const assignments = agentQueue(brief, agents);
  const localSchedule = runMode === 'manual' ? nextScheduledAt(now, config.sendTime || DEFAULT_SEND_TIME, config.timezone || DEFAULT_TIMEZONE) : now;
  const deliveryAt = deliverAt || (runMode === 'manual' && localSchedule > now ? localSchedule : now);
  const dueAt = new Date(deliveryAt.getTime() + 2 * 60 * 60 * 1000);
  const runId = crypto.randomUUID(), conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id,status,planned_count,assigned_count,skipped_count,failed_count FROM sx_pipeline_followup_assignment_runs WHERE tenant_id=? AND local_date=? LIMIT 1 FOR UPDATE', [config.tenantId, date]);
    if (existing.length) {
      await conn.rollback();
      return { runId: existing[0].id, status: existing[0].status, repeated: true, counts: { planned: Number(existing[0].planned_count), assigned: Number(existing[0].assigned_count), skipped: Number(existing[0].skipped_count), failed: Number(existing[0].failed_count) } };
    }
    await conn.query(`INSERT INTO sx_pipeline_followup_assignment_runs(id,tenant_id,uid_hash,local_date,timezone,run_mode,status,deliver_at,
      high_count,warm_count,candidate_count,existing_assigned_count,review_excluded_count,waiting_72h_count,planned_count)
      VALUES(?,?,?,?,?,?,'assigning',?,?,?,?,?,?,?,?)`, [runId, config.tenantId, config.uidHash, date, config.timezone || DEFAULT_TIMEZONE, runMode, dbDate(deliveryAt),
      Number(brief.summary.highIntent || 0), Number(brief.summary.warmInterest || 0), Number(brief.summary.total || 0),
      Math.max(0, Number(brief.summary.total || 0) - assignments.length), Number(brief.summary.needsReview || 0), Number(brief.summary.waiting72Hours || 0), assignments.length]);
    for (const item of assignments) {
      await conn.query(`INSERT INTO sx_pipeline_followup_assignment_items(tenant_id,run_id,lead_id,agent_id,priority,days_waiting)
        VALUES(?,?,?,?,?,?)`, [config.tenantId, runId, item.leadId, item.agentId, item.priority, item.daysWaiting]);
    }
    await conn.query("UPDATE sx_pipeline_followup_assignment_runs SET status='assigning' WHERE id=?", [runId]);
    await conn.commit();
  } catch (error) { try { await conn.rollback(); } catch {} throw error; }
  finally { conn.release(); }
  return { runId, status: 'assigning', repeated: false, counts: { candidates: Number(brief.summary.total || 0), planned: assignments.length, high: Number(brief.summary.highIntent || 0), warm: Number(brief.summary.warmInterest || 0), waiting72h: Number(brief.summary.waiting72Hours || 0), excludedReview: Number(brief.summary.needsReview || 0) }, deliverAt: deliveryAt.toISOString(), followUpDueAt: dueAt.toISOString() };
}
async function requestRun(source, ctx, { now = new Date() } = {}) {
  const actor = actorContext(ctx);
  if (actor.role !== 'owner' && ctx?.membership?.role !== 'owner') fail('PERMISSION_DENIED', 403);
  const db = poolOf(source);
  await assertTrainingCenter(db, actor.tenantId);
  const [setting] = await queryRows(db, 'SELECT tenant_id,uid_hash,enabled,timezone,send_time FROM sx_pipeline_followup_assignment_settings WHERE tenant_id=? AND uid_hash=? LIMIT 1', [actor.tenantId, actor.uidHash]);
  if (Number(setting?.enabled) !== 1) fail('AUTOMATION_DISABLED', 409);
  const schedule = await deliverySchedule(db, actor.tenantId);
  const config = { tenantId: actor.tenantId, uidHash: actor.uidHash, uid: actor.uid, ...schedule };
  return buildPlan(source, config, { now, runMode: 'manual' });
}
async function stillNeedsFollowUp(db, { uid, uidHash, leadId, expectedAgentId, assignedAt }) {
  const leads = await queryRows(db, `SELECT id,uid,uid_hash,chat_id,primary_origin,status,stage_key,owner_agent_id,contact_name,learner_name,title
    FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=? LIMIT 1`, [uidHash, uid, leadId]);
  const lead = leads[0];
  if (!lead || lead.status !== 'open') return { ok: false, reason: 'LEAD_CLOSED' };
  if (lead.owner_agent_id != null) return { ok: Number(lead.owner_agent_id) === Number(expectedAgentId), reason: Number(lead.owner_agent_id) === Number(expectedAgentId) ? 'ALREADY_ASSIGNED_TO_TARGET' : 'ALREADY_ASSIGNED' };
  const conversations = await queryRows(db, `SELECT DISTINCT chat_id AS chatId,origin FROM pipeline_conversations
    WHERE uid_hash=? AND lead_id=? AND origin IN ('qr','meta') AND LEFT(chat_id,8)<>'qrgroup_'`, [uidHash, leadId]);
  if (!conversations.length) return { ok: false, reason: 'NO_LINKED_DIRECT_CHAT' };
  const messages = [];
  for (const conversation of conversations) {
    const rows = await queryRows(db, `SELECT chat_id AS chatId,origin,id,type,route,sentBy,timestamp,createdAt,
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(msgContext),msgContext,'{}'),'$.text.body')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(msgContext),msgContext,'{}'),'$.button.text')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(msgContext),msgContext,'{}'),'$.interactive.button_reply.title')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(msgContext),msgContext,'{}'),'$.interactive.list_reply.title')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(msgContext),msgContext,'{}'),'$.image.caption')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(msgContext),msgContext,'{}'),'$.document.caption')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(msgContext),msgContext,'{}'),'$.video.caption')),''),'') AS textBody
      FROM beta_conversation WHERE uid=? AND chat_id=? AND origin=? AND route IN ('INCOMING','OUTGOING')
      ORDER BY id DESC LIMIT 100`, [uid, conversation.chatId, conversation.origin]);
    messages.push(...rows);
  }
  const current = followUpBrief.assessLead(lead, messages, Date.now());
  if (!current || !['high', 'warm'].includes(current.priority)) return { ok: false, reason: 'NO_LONGER_ELIGIBLE' };
  const snapshotAt = utcMillis(assignedAt);
  const latestInboundAt = Date.parse(current.lastCustomerAt);
  if (Number.isFinite(snapshotAt) && latestInboundAt > snapshotAt + 1000) return { ok: false, reason: 'NEWER_CUSTOMER_MESSAGE' };
  return { ok: true, priority: current.priority, daysWaiting: current.daysWaiting, lead };
}
async function syncChatAssignments(db, { uid, uidHash, lead, agentId }) {
  const [rows] = await db.query('SELECT id,uid,name,email FROM agents WHERE id=? AND owner_uid=? AND is_active=1 AND role=\'agent\' LIMIT 1', [agentId, uid]);
  const target = rows[0];
  if (!target) fail('ASSIGNEE_NOT_ACTIVE', 409);
  const [conversationRows] = await db.query(`SELECT DISTINCT chat_id FROM pipeline_conversations WHERE uid_hash=? AND lead_id=? AND chat_id IS NOT NULL AND chat_id<>''`, [uidHash, lead.id]);
  const chats = [...new Set((conversationRows || []).map(row => String(row.chat_id)).filter(Boolean))];
  if (!chats.length && lead.chat_id) chats.push(String(lead.chat_id));
  for (const chatId of chats) {
    await db.query('INSERT IGNORE INTO agent_chats(owner_uid,uid,chat_id) VALUES(?,?,?)', [uid, target.uid, chatId]);
    const [chatRows] = await db.query('SELECT assigned_agent FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1 FOR UPDATE', [uid, chatId]);
    if (chatRows.length) {
      let assigned = [];
      try { const parsed = typeof chatRows[0].assigned_agent === 'string' ? JSON.parse(chatRows[0].assigned_agent) : chatRows[0].assigned_agent; assigned = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []; } catch {}
      if (!assigned.some(item => String(item?.id) === String(target.id) || item?.uid === target.uid)) assigned.push(target);
      await db.query('UPDATE beta_chats SET assigned_agent=? WHERE uid=? AND chat_id=?', [JSON.stringify(assigned), uid, chatId]);
    }
  }
  return { chatsAssigned: chats.length, agentUid: target.uid };
}
async function claimItems(source, runId, workerId, limit = MAX_BATCH) {
  const db = poolOf(source), conn = await db.getConnection(), token = crypto.randomUUID();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT id,lead_id,agent_id,priority,days_waiting,attempts FROM sx_pipeline_followup_assignment_items
      WHERE run_id=? AND (status='planned' OR (status='failed' AND attempts<3 AND (retry_after IS NULL OR retry_after<=UTC_TIMESTAMP(3)))
        OR (status='processing' AND lease_until<UTC_TIMESTAMP(3))) ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`, [runId, Math.max(1, Math.min(MAX_BATCH, Number(limit) || MAX_BATCH))]);
    for (const row of rows) await conn.query(`UPDATE sx_pipeline_followup_assignment_items SET status='processing',attempts=attempts+1,lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND)
      WHERE id=?`, [token, LEASE_SECONDS, row.id]);
    await conn.commit();
    return rows.map(row => ({ ...row, leaseToken: token, workerId }));
  } catch (error) { try { await conn.rollback(); } catch {} throw error; }
  finally { conn.release(); }
}
async function finishItem(source, item, { status, errorCode = null, priority = null, daysWaiting = null } = {}) {
  const db = poolOf(source);
  await db.query(`UPDATE sx_pipeline_followup_assignment_items SET status=?,lease_token=NULL,lease_until=NULL,retry_after=IF(?='failed' AND attempts<3,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),NULL),
    last_error_code=?,priority=COALESCE(?,priority),days_waiting=COALESCE(?,days_waiting),assigned_at=IF(?='assigned',UTC_TIMESTAMP(3),assigned_at)
    WHERE id=? AND status='processing' AND lease_token=?`, [status, status, errorCode, priority, daysWaiting, status, item.id, item.leaseToken]);
}
async function processItem(source, config, run, item) {
  const db = poolOf(source);
  const fresh = await stillNeedsFollowUp(db, { uid: config.uid, uidHash: config.uidHash, leadId: item.lead_id, expectedAgentId: item.agent_id, assignedAt: run.created_at });
  if (fresh.reason === 'ALREADY_ASSIGNED_TO_TARGET') {
    await finishItem(db, item, { status: 'assigned' });
    return 'assigned';
  }
  if (!fresh.ok) {
    await finishItem(db, item, { status: fresh.reason === 'ALREADY_ASSIGNED_TO_TARGET' ? 'assigned' : 'skipped' });
    return fresh.reason === 'ALREADY_ASSIGNED_TO_TARGET' ? 'assigned' : 'skipped';
  }
  try {
    const due = new Date(utcMillis(run.deliver_at) + 2 * 60 * 60 * 1000);
    const result = await require('../../helper/pipeline/leadPipeline').updateLead({ uid: config.uid, id: item.lead_id, input: { ownerAgentId: Number(item.agent_id), nextFollowUpAt: due.toISOString() },
      actorType: 'system', actorId: `daily-follow-up:${run.id}`, role: 'owner', categoryKey: 'training_center', pool: db,
      onAssignmentChange: async (conn, { lead, assignmentChange }) => {
        if (assignmentChange.fromAgentId !== null) fail('ALREADY_ASSIGNED', 409);
        return syncChatAssignments(conn, { uid: config.uid, uidHash: config.uidHash, lead, agentId: Number(item.agent_id) });
      } });
    const agentUid = result?.assignment?.agentUid;
    await finishItem(db, item, { status: 'assigned', priority: fresh.priority, daysWaiting: fresh.daysWaiting });
    return { status: 'assigned', agentUid };
  } catch (error) {
    if (error?.code === 'ALREADY_ASSIGNED') {
      const leads = await queryRows(db, 'SELECT owner_agent_id FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=? LIMIT 1', [config.uidHash, config.uid, item.lead_id]);
      const status = Number(leads[0]?.owner_agent_id) === Number(item.agent_id) ? 'assigned' : 'skipped';
      await finishItem(db, item, { status });
      return status;
    }
    const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code || '') ? error.code : 'ASSIGNMENT_FAILED';
    await finishItem(db, item, { status: 'failed', errorCode: code });
    return { status: 'failed', errorCode: code };
  }
}
async function lookupRecipientsForDigests(db, tenantId, uid, agentRows) {
  const managerRows = await loadSummaryRecipients(db, tenantId);
  return recipientsByPhone(agentRows, managerRows);
}
async function queueDigests(source, config, run) {
  const db = poolOf(source);
  const rows = await queryRows(db, `SELECT i.agent_id,i.priority,i.days_waiting,i.status FROM sx_pipeline_followup_assignment_items i WHERE i.tenant_id=? AND i.run_id=?`, [config.tenantId, run.id]);
  const agents = await loadAgents(db, { tenantId: config.tenantId, uid: config.uid });
  const brief = { summary: { needsReview: Number(run.review_excluded_count || 0) } };
  const recipients = await lookupRecipientsForDigests(db, config.tenantId, config.uid, agents);
  const digests = makeDigests({ date: dateOnly(run.local_date), agents, runItems: rows, brief, noPhoneAgents: recipients.noPhoneAgents,
    identifiedCount: Number(run.candidate_count || 0), existingAssigned: Number(run.existing_assigned_count || 0) });
  const deliveryAt = new Date(run.deliver_at);
  let queued = 0, index = 0;
  for (const group of recipients.groups) {
    const roleSummary = group.roles.some(role => role === 'owner' || role === 'manager');
    const agentText = group.agentId == null ? null : digests.agentMessages.get(Number(group.agentId));
    const text = [agentText, roleSummary ? digests.ownerText : null].filter(Boolean).join('\n\n');
    if (!text) continue;
    const available = new Date(deliveryAt.getTime() + index * 20 * 1000);
    const [result] = await db.query(`INSERT IGNORE INTO sx_pipeline_followup_assignment_outbox(tenant_id,run_id,recipient_type,recipient_id,phone_hash,message_text,available_at)
      VALUES(?,?,?,?,?,?,?)`, [config.tenantId, run.id, group.recipientType, group.recipientId, group.phoneHash, text.slice(0, 1800), dbDate(available)]);
    queued += Number(result.affectedRows || 0);
    index++;
  }
  await db.query(`UPDATE sx_pipeline_followup_assignment_runs SET status=IF((SELECT COUNT(*) FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND status='failed')>0,'partial','complete'),
    high_count=(SELECT COUNT(*) FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND status='assigned' AND priority='high'),
    warm_count=(SELECT COUNT(*) FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND status='assigned' AND priority='warm'),
    waiting_72h_count=(SELECT COUNT(*) FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND status='assigned' AND days_waiting>=3),
    assigned_count=(SELECT COUNT(*) FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND status='assigned'),
    skipped_count=(SELECT COUNT(*) FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND status='skipped'),
    failed_count=(SELECT COUNT(*) FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND status='failed'),
    notification_count=(SELECT COUNT(*) FROM sx_pipeline_followup_assignment_outbox WHERE run_id=? AND status<>'cancelled'),
    no_phone_agent_count=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?`, [run.id, run.id, run.id, run.id, run.id, run.id, run.id, run.id, recipients.noPhoneAgents, run.id]);
  return { queued, assigned: digests.counts.assigned, noPhoneAgents: recipients.noPhoneAgents };
}
async function processRun(source, config, runId, { workerId = `followup-${process.pid}` } = {}) {
  const db = poolOf(source);
  const runs = await queryRows(db, `SELECT * FROM sx_pipeline_followup_assignment_runs WHERE id=? AND tenant_id=? LIMIT 1`, [runId, config.tenantId]);
  const run = runs[0];
  if (!run || ['complete', 'partial', 'failed'].includes(run.status)) return { status: run?.status || 'missing', assigned: Number(run?.assigned_count || 0), queued: 0 };
  let assigned = 0, skipped = 0, failed = 0;
  while (true) {
    const items = await claimItems(db, runId, workerId, 20);
    if (!items.length) break;
    for (const item of items) {
      const result = await processItem(db, config, run, item);
      const status = typeof result === 'string' ? result : result.status;
      if (status === 'assigned') {
        assigned++;
        if (result?.agentUid) { try { require('../../socket').sendToUid(result.agentUid, {}, 'request_update_chat_list'); } catch {} }
      } else if (status === 'skipped') skipped++;
      else if (status === 'failed') failed++;
    }
  }
  const pendingRows = await queryRows(db, `SELECT COUNT(*) AS count FROM sx_pipeline_followup_assignment_items WHERE run_id=? AND (status IN ('planned','processing') OR (status='failed' AND attempts<3 AND retry_after>UTC_TIMESTAMP(3)))`, [runId]);
  if (Number(pendingRows[0]?.count || 0)) return { status: 'assigning', assigned, skipped, failed, queued: 0 };
  const outbox = await queueDigests(db, config, run);
  const finalRows = await queryRows(db, 'SELECT status,assigned_count,skipped_count,failed_count,notification_count FROM sx_pipeline_followup_assignment_runs WHERE id=?', [runId]);
  return { status: finalRows[0]?.status || 'complete', assigned: Number(finalRows[0]?.assigned_count || 0), skipped: Number(finalRows[0]?.skipped_count || 0), failed: Number(finalRows[0]?.failed_count || 0), queued: outbox.queued };
}
async function claimOutbox(source, workerId, limit = 20) {
  const db = poolOf(source), conn = await db.getConnection(), token = crypto.randomUUID();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE sx_pipeline_followup_assignment_outbox SET status='unknown',last_error_code='DELIVERY_LEASE_EXPIRED',lease_token=NULL,lease_until=NULL WHERE status='sending' AND lease_until<UTC_TIMESTAMP(3)");
    const [rows] = await conn.query(`SELECT o.*,s.uid_hash,s.timezone FROM sx_pipeline_followup_assignment_outbox o
      JOIN sx_pipeline_followup_assignment_runs r ON r.id=o.run_id AND r.tenant_id=o.tenant_id
      JOIN sx_pipeline_followup_assignment_settings s ON s.tenant_id=o.tenant_id
      WHERE o.status='queued' AND o.available_at<=UTC_TIMESTAMP(3) ORDER BY o.available_at,o.id LIMIT ? FOR UPDATE SKIP LOCKED`, [Math.max(1, Math.min(50, Number(limit) || 20))]);
    for (const row of rows) await conn.query("UPDATE sx_pipeline_followup_assignment_outbox SET status='sending',attempts=attempts+1,lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 180 SECOND) WHERE id=?", [token, row.id]);
    await conn.commit();
    return rows.map(row => ({ ...row, leaseToken: token, workerId }));
  } catch (error) { try { await conn.rollback(); } catch {} throw error; }
  finally { conn.release(); }
}
async function resolveOutboxRecipient(db, item) {
  let rows;
  if (item.recipient_type === 'agent') rows = await queryRows(db, `SELECT a.mobile AS phone,a.owner_uid AS uid FROM agents a
    JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=?
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role IN ('agent','manager') AND m.status='active'
    WHERE a.id=? AND a.is_active=1 LIMIT 1`, [item.tenant_id, item.recipient_id]);
  else rows = await queryRows(db, `SELECT u.mobile_with_country_code AS phone,u.uid FROM user u
    JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=?
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role IN ('owner','manager') AND m.status='active'
    WHERE u.id=CAST(? AS UNSIGNED) AND u.role='user' LIMIT 1`, [item.tenant_id, item.recipient_id]);
  const row = rows[0], phone = normalizePhone(row?.phone);
  if (!row || !phone || digest(phone) !== String(item.phone_hash)) return null;
  return { phone, uid: String(row.uid) };
}
function qrInternalUrl(env = process.env) {
  const secret = String(env.CRM_INTERNAL_SECRET || '');
  const port = Number(env.PORT || 3010);
  const base = String(env.SALEMAX_TASK_QR_INTERNAL_ORIGIN || `http://app:${Number.isSafeInteger(port) ? port : 3010}`);
  let url;
  try {
    const origin = new URL(base);
    if (!secret || origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', 'app'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return null;
    url = origin.origin + '/api/internal/qr/send-text';
  } catch { return null; }
  return { url, secret };
}
async function sendOutbox(source, item, { http = require('axios'), env = process.env } = {}) {
  const db = poolOf(source);
  const recipient = await resolveOutboxRecipient(db, item);
  if (!recipient) return { status: 'failed', errorCode: 'RECIPIENT_CHANGED_OR_UNAVAILABLE' };
  const instances = await queryRows(db, 'SELECT number FROM instance WHERE uid=? AND status=\'ACTIVE\' ORDER BY id LIMIT 2', [recipient.uid]);
  if (instances.length !== 1) return { status: 'failed', errorCode: instances.length ? 'QR_INSTANCE_AMBIGUOUS' : 'QR_INSTANCE_UNAVAILABLE' };
  const from = normalizePhone(instances[0].number);
  if (!from) return { status: 'failed', errorCode: 'QR_INSTANCE_NUMBER_INVALID' };
  const internal = qrInternalUrl(env);
  if (!internal) return { status: 'failed', errorCode: 'QR_SENDER_NOT_CONFIGURED' };
  try {
    const response = await http.post(internal.url, { uid: recipient.uid, from, to: recipient.phone, text: String(item.message_text || '').slice(0, 1800) },
      { headers: { 'x-internal-secret': internal.secret }, timeout: 20000 });
    const messageId = response?.data?.data?.messageId;
    return response?.data?.success && messageId ? { status: 'accepted', messageId: String(messageId).slice(0, 191) } : { status: 'unknown', errorCode: 'QR_ACCEPTANCE_UNCONFIRMED' };
  } catch (error) {
    const status = Number(error?.response?.status), code = String(error?.code || '');
    if (status === 404) return { status: Number(item.attempts || 0) < 3 ? 'retry' : 'failed', errorCode: 'QR_INSTANCE_TEMPORARILY_UNAVAILABLE' };
    if (status >= 400 && status < 500) return { status: 'failed', errorCode: 'QR_SEND_REJECTED' };
    if (status || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ESOCKETTIMEDOUT'].includes(code)) return { status: 'unknown', errorCode: 'QR_SEND_OUTCOME_UNKNOWN' };
    return { status: 'unknown', errorCode: 'QR_SEND_OUTCOME_UNKNOWN' };
  }
}
async function finishOutbox(source, item, result) {
  const db = poolOf(source);
  const state = result.status === 'retry' && Number(item.attempts || 0) < 3 ? 'queued' : result.status;
  const delaySeconds = state === 'queued' ? 300 : 0;
  await db.query(`UPDATE sx_pipeline_followup_assignment_outbox SET status=?,available_at=IF(?='queued',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),available_at),
    lease_token=NULL,lease_until=NULL,last_error_code=?,provider_message_id=?,sent_at=IF(?='accepted',UTC_TIMESTAMP(3),sent_at)
    WHERE id=? AND status='sending' AND lease_token=?`, [state, state, delaySeconds, result.errorCode || null, result.messageId || null, state, item.id, item.leaseToken]);
  return state;
}
async function deliverOutbox(source, { workerId = `followup-delivery-${process.pid}`, limit = 20, http, env = process.env } = {}) {
  const items = await claimOutbox(source, workerId, limit);
  const totals = { claimed: items.length, accepted: 0, failed: 0, unknown: 0, retrying: 0 };
  for (const item of items) {
    try {
      const result = await sendOutbox(source, item, { http, env });
      const state = await finishOutbox(source, item, result);
      if (state === 'accepted') totals.accepted++;
      else if (state === 'failed') totals.failed++;
      else if (state === 'unknown') totals.unknown++;
      else totals.retrying++;
    } catch {
      try { await finishOutbox(source, item, { status: 'unknown', errorCode: 'QR_SEND_OUTCOME_UNKNOWN' }); } catch {}
      totals.unknown++;
    }
  }
  return totals;
}
async function tick(source, { workerId = `followup-${process.pid}`, now = new Date(), limit = 20 } = {}) {
  const db = poolOf(source);
  const settings = await queryRows(db, `SELECT s.tenant_id,s.uid_hash,s.timezone,s.send_time FROM sx_pipeline_followup_assignment_settings s
    JOIN sx_tenants t ON t.id=s.tenant_id AND t.category_key='training_center' AND t.status='active'
    WHERE s.enabled=1 ORDER BY s.tenant_id LIMIT 100`);
  const runs = [];
  for (const setting of settings) {
    try {
      const uid = await resolveWorkspace(db, setting.uid_hash);
      const schedule = await deliverySchedule(db, setting.tenant_id);
      const config = { tenantId: setting.tenant_id, uidHash: setting.uid_hash, uid, ...schedule };
      const date = qatarDate(now, config.timezone);
      let run = await latestRun(db, config.tenantId, date);
      if (!run && qatarTime(now, config.timezone) >= config.sendTime) {
        const planned = await buildPlan(db, config, { now, runMode: 'scheduled' });
        run = await latestRun(db, config.tenantId, date);
        if (!run && planned.runId) run = await latestRun(db, config.tenantId, date);
      }
      if (run && !['complete', 'partial', 'failed'].includes(run.status)) runs.push(await processRun(db, config, run.id, { workerId }));
    } catch (error) {
      runs.push({ status: 'failed', errorCode: /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code || '') ? error.code : 'FOLLOW_UP_ASSIGNMENT_FAILED' });
    }
  }
  const delivery = await deliverOutbox(db, { workerId: `${workerId}-wa`, limit });
  return { runs, delivery };
}

module.exports = { DEFAULT_TIMEZONE, DEFAULT_SEND_TIME, qatarDate, qatarTime, zonedDateTime, nextScheduledAt, normalizePhone, agentQueue, recipientsByPhone, makeDigests, getSettings, saveSettings, requestRun, buildPlan, processRun, claimItems, processItem, claimOutbox, resolveOutboxRecipient, sendOutbox, finishOutbox, deliverOutbox, tick, _private: { actorContext, dbDate, dateOnly, utcMillis, digest, loadAgents, loadSummaryRecipients, deliverySchedule, stillNeedsFollowUp, syncChatAssignments, queueDigests, shortDate, qrInternalUrl } };
