'use strict';

const crypto = require('node:crypto');
const { decision } = require('./policy');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = code => { throw Object.assign(new Error(code), { code }); };
function authorize(context, permission) {
  if (context?.tenant?.categoryKey !== 'salemax_sales') fail('CATEGORY_UNAVAILABLE');
  const access = decision(context, { capability: 'telephony.call-center', permission });
  if (!access.allowed) fail(access.code);
  return access;
}

async function getPolicy(db, context) {
  authorize(context, 'calls.read');
  const [[row]] = await db.query(`SELECT enabled,notice_confirmed AS noticeConfirmed,notice_version AS noticeVersion,
    retention_days AS retentionDays,revision FROM sx_telephony_recording_policies WHERE tenant_id=?`, [context.tenant.id]);
  return row ? { enabled: !!row.enabled, noticeConfirmed: !!row.noticeConfirmed, noticeVersion: Number(row.noticeVersion),
    retentionDays: row.retentionDays === null ? null : Number(row.retentionDays), revision: Number(row.revision) }
    : { enabled: false, noticeConfirmed: false, noticeVersion: 1, retentionDays: null, revision: 0 };
}

async function savePolicy(db, context, input) {
  authorize(context, 'calls.recording.manage');
  if (!input || typeof input.enabled !== 'boolean' || typeof input.noticeConfirmed !== 'boolean'
    || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
    || (input.retentionDays !== null && (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 365))) fail('INVALID_RECORDING_POLICY');
  if (input.enabled && (!input.noticeConfirmed || input.retentionDays === null)) fail('RECORDING_POLICY_PREREQUISITES_REQUIRED');
  const id = crypto.randomUUID();
  await db.beginTransaction();
  try {
    await db.query(`INSERT IGNORE INTO sx_telephony_recording_policies(tenant_id,revision) VALUES(?,0)`, [context.tenant.id]);
    const [[current]] = await db.query(`SELECT revision FROM sx_telephony_recording_policies WHERE tenant_id=? FOR UPDATE`, [context.tenant.id]);
    if (Number(current.revision) !== input.expectedRevision) fail('STALE_RECORDING_POLICY');
    await db.query(`UPDATE sx_telephony_recording_policies SET enabled=?,notice_confirmed=?,retention_days=?,
      updated_by_identity_id=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=?`,
    [input.enabled ? 1 : 0, input.noticeConfirmed ? 1 : 0, input.retentionDays, context.identity.id, context.tenant.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
      VALUES(?,?,?,'identity','telephony.recording-policy.updated','telephony-recording-policy',?,?,?,?)`,
    [id, context.tenant.id, context.identity.id, context.tenant.id, 'Tenant recording policy changed',
      JSON.stringify({ enabled: input.enabled, noticeConfirmed: input.noticeConfirmed, retentionDays: input.retentionDays }), crypto.randomUUID()]);
    await db.commit();
    return { enabled: input.enabled, noticeConfirmed: input.noticeConfirmed, noticeVersion: 1, retentionDays: input.retentionDays,
      revision: Number(current.revision) + 1 };
  } catch (error) { try { await db.rollback(); } catch (_) {} throw error; }
}

async function startForCall(pool, ariClientFactory, tenantId, callId, bridgeId) {
  if (!UUID.test(tenantId || '') || !UUID.test(callId || '') || !UUID.test(bridgeId || '')) fail('INVALID_RECORDING_CALL');
  const db = await pool.getConnection();
  const recordingName = `salemax_${callId.replace(/-/g, '').toLowerCase()}`;
  let enabled = false;
  try {
    await db.beginTransaction();
    const [[policy]] = await db.query(`SELECT enabled,notice_confirmed,retention_days FROM sx_telephony_recording_policies
      WHERE tenant_id=? FOR UPDATE`, [tenantId]);
    if (policy?.enabled) {
      if (!Number(policy.notice_confirmed) || !Number(policy.retention_days)) fail('RECORDING_POLICY_PREREQUISITES_REQUIRED');
      const [[call]] = await db.query(`SELECT status FROM sx_telephony_calls WHERE tenant_id=? AND id=? FOR UPDATE`, [tenantId, callId]);
      if (!call || call.status !== 'connected') fail('CALL_NOT_CONNECTED');
      const id = crypto.randomUUID();
      const [inserted] = await db.query(`INSERT IGNORE INTO sx_telephony_call_recordings(tenant_id,id,call_id,recording_name,state,expires_at)
        VALUES(?,?,?,?,'starting',UTC_TIMESTAMP(3)+INTERVAL ? DAY)`, [tenantId, id, callId, recordingName, Number(policy.retention_days)]);
      if (Number(inserted.affectedRows) === 1) enabled = true;
    }
    await db.commit();
  } catch (error) { try { await db.rollback(); } catch (_) {} throw error; }
  finally { db.release(); }
  if (!enabled) return { started: false };
  try {
    const client = await ariClientFactory(pool);
    await client.recordBridge(bridgeId, recordingName);
    await pool.query(`UPDATE sx_telephony_call_recordings SET state='recording',updated_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND call_id=? AND state='starting'`, [tenantId, callId]);
    return { started: true, recordingName };
  } catch (error) {
    await pool.query(`UPDATE sx_telephony_call_recordings SET state='failed',failure_code=?,finished_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND call_id=? AND state='starting'`, [(/^[A-Z0-9_]{2,80}$/.test(error.code || '') ? error.code : 'RECORDING_START_FAILED'), tenantId, callId]);
    throw error;
  }
}

async function handleFinished(pool, ariClientFactory, event) {
  const recording = event?.recording;
  if (!recording || typeof recording.name !== 'string' || !/^salemax_[a-f0-9]{32}$/.test(recording.name)) return false;
  const rawDuration = Number(recording.duration), duration = Number.isInteger(rawDuration) && rawDuration >= 0 && rawDuration <= 86400 ? rawDuration : null;
  const [[current]] = await pool.query(`SELECT tenant_id,state,expires_at<=UTC_TIMESTAMP(3) AS expired
    FROM sx_telephony_call_recordings WHERE recording_name=?`, [recording.name]);
  if (!current) return false;
  if (Number(current.expired) === 1 || current.state === 'expired') {
    const client = await ariClientFactory(pool);
    await client.deleteStoredRecording(recording.name);
    await pool.query(`UPDATE sx_telephony_call_recordings SET state='expired',finished_at=COALESCE(finished_at,UTC_TIMESTAMP(3))
      WHERE recording_name=?`, [recording.name]);
    return true;
  }
  await pool.query(`UPDATE sx_telephony_call_recordings SET state='ready',finished_at=UTC_TIMESTAMP(3),
    duration_seconds=?,failure_code=NULL,updated_at=UTC_TIMESTAMP(3)
    WHERE recording_name=? AND state IN ('starting','recording')`, [duration, recording.name]);
  return true;
}

async function expireRecordings(pool, ariClientFactory, limit = 50) {
  const [rows] = await pool.query(`SELECT tenant_id,id,recording_name AS recordingName FROM sx_telephony_call_recordings
    WHERE state IN ('starting','recording','ready','failed') AND expires_at<=UTC_TIMESTAMP(3)
    ORDER BY expires_at,id LIMIT ?`, [Math.max(1, Math.min(100, Number(limit) || 50))]);
  if (!rows.length) return 0;
  const client = await ariClientFactory(pool);
  let expired = 0;
  for (const row of rows) {
    try {
      const deleted = await client.deleteStoredRecording(row.recordingName);
      if (!deleted) { try { await client.stopLiveRecording(row.recordingName); } catch (error) { if (error.code !== 'ARI_RESOURCE_NOT_FOUND') throw error; } }
      const [updated] = await pool.query(`UPDATE sx_telephony_call_recordings SET state='expired',updated_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND id=? AND state IN ('starting','recording','ready','failed') AND expires_at<=UTC_TIMESTAMP(3)`, [row.tenant_id,row.id]);
      expired += Number(updated.affectedRows || 0);
    } catch (_) { /* retry on the next pass; failures are deliberately not logged with PBX details */ }
  }
  return expired;
}

async function accessibleCall(db, context, callId) {
  const [[call]] = await db.query(`SELECT c.id,c.started_by_membership_id AS startedBy,c.answered_by_membership_id AS answeredBy,
    c.inbound_queue_id AS queueId FROM sx_telephony_calls c WHERE c.tenant_id=? AND c.id=?`, [context.tenant.id, callId]);
  if (!call) fail('CALL_NOT_FOUND');
  const role = context.membership.role;
  if (role === 'owner') return call;
  if (role === 'manager' || role === 'team_leader') {
    const column = role === 'manager' ? 'manager_membership_id' : 'team_leader_membership_id';
    const [members] = await db.query(`SELECT membership_id AS id FROM sx_sales_org_history
      WHERE tenant_id=? AND ${column}=? AND ended_at IS NULL UNION SELECT ? AS id`,
    [context.tenant.id, context.membership.id, context.membership.id]);
    const ids = [...new Set(members.map(item => item.id))];
    if (!ids.length) fail('PERMISSION_DENIED');
    const [legs] = await db.query(`SELECT id FROM sx_telephony_call_legs WHERE tenant_id=? AND call_id=? AND membership_id IN (?) LIMIT 1`,
    [context.tenant.id, callId, ids]);
    if (!ids.includes(call.startedBy) && !ids.includes(call.answeredBy) && !legs.length) fail('PERMISSION_DENIED');
    return call;
  }
  if (role === 'agent') {
    if (call.startedBy === context.membership.id || call.answeredBy === context.membership.id) return call;
    const [[membershipLeg]] = await db.query(`SELECT id FROM sx_telephony_call_legs WHERE tenant_id=? AND call_id=? AND membership_id=? LIMIT 1`,
    [context.tenant.id, callId, context.membership.id]);
    const [[queueMember]] = call.queueId ? await db.query(`SELECT membership_id FROM sx_telephony_queue_members WHERE tenant_id=? AND queue_id=? AND membership_id=?`,
      [context.tenant.id, call.queueId, context.membership.id]) : [[null]];
    if (!membershipLeg && !queueMember) fail('PERMISSION_DENIED');
    return call;
  }
  fail('PERMISSION_DENIED');
}

async function openRecording(db, context, callId) {
  authorize(context, 'calls.recording.listen');
  if (!UUID.test(callId || '')) fail('INVALID_CALL_ID');
  await accessibleCall(db, context, callId);
  const [[recording]] = await db.query(`SELECT id,recording_name AS recordingName,state,expires_at AS expiresAt
    FROM sx_telephony_call_recordings WHERE tenant_id=? AND call_id=?`, [context.tenant.id, callId]);
  if (!recording || recording.state !== 'ready' || new Date(recording.expiresAt).getTime() <= Date.now()) fail('RECORDING_NOT_READY');
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
    VALUES(?,?,?,'identity','telephony.call-recording.played','telephony-call-recording',?,?,?,?)`,
  [crypto.randomUUID(), context.tenant.id, context.identity.id, recording.id, 'Recording playback requested',
    JSON.stringify({ callId }), crypto.randomUUID()]);
  return recording;
}

module.exports = { getPolicy, savePolicy, startForCall, handleFinished, expireRecordings, openRecording, accessibleCall };
