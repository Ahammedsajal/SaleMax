'use strict';

const { z } = require('zod');
const databaseConfig = require('../../../database/config');
const getPool = databaseConfig.promise.bind(databaseConfig);
const pipeline = require('../../../helper/pipeline/leadPipeline');
const taskManagement = require('../task-management');
const oauth = require('./oauth');
const identity = require('./identity');

const pool = () => getPool();
const uuid = z.string().uuid();
const safeResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const safeError = error => ({ isError: true, content: [{ type: 'text', text: error?.code || 'REQUEST_FAILED' }] });
const hasScope = (auth, scope) => auth.scopes.has(scope);

async function auditCall(auth, toolName, resourceId, outcome, code) {
  await oauth.audit(pool(), {
    connectionId: auth.connectionId,
    clientId: auth.clientId,
    eventType: outcome === 'success' ? 'tool_called' : 'tool_denied',
    toolName,
    resourceId: resourceId ? String(resourceId).slice(0, 191) : null,
    outcome,
    details: code ? { code: String(code).slice(0, 48) } : null,
  });
}

async function runTool(auth, toolName, scope, resourceId, operation, { auditSuccess = true } = {}) {
  try {
    if (!hasScope(auth, scope)) throw identity.denied('INSUFFICIENT_SCOPE', 403);
    const result = await operation();
    if (auditSuccess) await auditCall(auth, toolName, resourceId, 'success');
    return safeResult(result);
  } catch (error) {
    await auditCall(auth, toolName, resourceId, 'denied', error?.code || 'REQUEST_FAILED');
    return safeError(error);
  }
}

function appendActorScope(actor, conditions, values) {
  const current = actor.pipelineActor;
  if (current.role === 'agent') {
    conditions.push('l.owner_agent_id=?');
    values.push(Number(current.agentId));
  } else if (['manager', 'team_leader'].includes(current.role) && Array.isArray(current.scopeAgentIds)) {
    if (current.scopeAgentIds.length) {
      conditions.push('l.owner_agent_id IN (?)');
      values.push(current.scopeAgentIds.map(Number));
    } else conditions.push('1=0');
  }
}

async function searchLeads(actor, { query, status = 'open', limit = 20 }) {
  const needle = String(query || '').trim();
  if (needle.length < 2 || needle.length > 80 || /[\u0000-\u001f\u007f]/u.test(needle)) throw identity.denied('INVALID_SEARCH', 400);
  const take = Math.max(1, Math.min(50, Number(limit) || 20));
  const conditions = ['l.uid_hash=?'];
  const values = [actor.uidHash];
  appendActorScope(actor, conditions, values);
  if (status === 'open') conditions.push("l.status='open'");
  else if (status !== 'all') throw identity.denied('INVALID_SEARCH', 400);
  conditions.push(`(LOCATE(LOWER(?),LOWER(COALESCE(l.title,'')))>0
    OR LOCATE(LOWER(?),LOWER(COALESCE(l.contact_name,'')))>0
    OR LOCATE(LOWER(?),LOWER(COALESCE(l.learner_name,'')))>0
    OR LOCATE(LOWER(?),LOWER(COALESCE(c.display_name,'')))>0)`);
  values.push(needle, needle, needle, needle, take);
  const [rows] = await pool().query(
    `SELECT l.id AS leadId,l.title,l.contact_name AS contactName,l.learner_name AS learnerName,
       l.status,l.priority,l.stage_key AS stageKey,s.title AS stageTitle,
       l.next_follow_up_at AS nextFollowUpAt,
       a.name AS ownerName,l.updated_at AS updatedAt
     FROM pipeline_leads l
     LEFT JOIN pipeline_contacts c ON c.uid_hash=l.uid_hash AND c.id=l.contact_id
     LEFT JOIN pipeline_stages s ON s.uid_hash=l.uid_hash AND s.stage_key=l.stage_key
     LEFT JOIN agents a ON a.id=l.owner_agent_id AND a.owner_uid COLLATE utf8mb4_general_ci=l.uid COLLATE utf8mb4_general_ci
     WHERE ${conditions.join(' AND ')} ORDER BY l.updated_at DESC,l.id DESC LIMIT ?`, values,
  );
  return { items: rows, limit: take, query: needle, status };
}

async function listFollowUps(actor, { period = 'all', limit = 20 } = {}) {
  const current = actor.pipelineActor;
  const result = await pipeline.getFollowUps({
    uid: current.uid,
    role: current.role,
    agentId: current.agentId,
    scopeAgentIds: current.scopeAgentIds,
    period,
    page: 1,
    limit: Math.max(1, Math.min(100, Number(limit) || 20)),
    pool: pool(),
  });
  return {
    summary: result.summary,
    period: result.period,
    timezone: current.timezone || 'Asia/Qatar',
    total: result.total,
    items: result.items.map(item => ({
      leadId: item.lead_id,
      title: item.title,
      contactName: item.relationship_name || item.contact_name || null,
      learnerName: item.learner_name || null,
      stage: item.stage_title || item.stage_key || null,
      dueAt: item.next_follow_up_at,
      overdue: Boolean(item.overdue),
      owner: item.owner_name || null,
    })),
  };
}

async function listTasks(actor, { status = 'active', scope = 'mine', limit = 20 } = {}) {
  const ctx = await identity.taskContext(actor, 'tasks.read');
  if (!ctx) throw identity.denied('PERMISSION_DENIED');
  const db = await pool().getConnection();
  try {
    const data = await taskManagement.list(db, ctx, { status, scope, page: 1, limit: Math.max(1, Math.min(50, Number(limit) || 20)) });
    return {
      items: data.items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.status,
        priority: item.priority,
        dueAt: item.due_at,
        revision: Number(item.revision),
        leadId: item.lead_id || null,
        lead: item.lead_title ? { title: item.lead_title, contactName: item.lead_contact || null, learnerName: item.lead_learner_name || null } : null,
      })),
      page: data.page,
      limit: data.limit,
      hasMore: data.hasMore,
      scope,
    };
  } finally { db.release(); }
}

function canonicalRequest(input) {
  return {
    leadId: input.lead_id,
    title: input.title.trim(),
    description: String(input.description || '').trim(),
    dueAt: new Date(input.due_at).toISOString(),
    priority: input.priority || 'normal',
  };
}

async function createFollowUpTask(actor, auth, input) {
  const ctx = await identity.taskContext(actor, 'tasks.manage');
  if (!ctx) throw identity.denied('PERMISSION_DENIED');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(input.due_at) || !Number.isFinite(Date.parse(input.due_at))) {
    throw identity.denied('INVALID_TASK_DUE_DATE', 400);
  }
  const request = canonicalRequest(input);
  const requestHash = oauth.sha(JSON.stringify(request));
  const db = await pool().getConnection();
  try {
    await db.beginTransaction();
    await db.query('DELETE FROM mcp_tool_idempotency WHERE connection_id=? AND idempotency_key=? AND expires_at<=UTC_TIMESTAMP(3)', [auth.connectionId, input.idempotency_key]);
    const [existingRows] = await db.query('SELECT request_hash,result_json FROM mcp_tool_idempotency WHERE connection_id=? AND idempotency_key=? LIMIT 1 FOR UPDATE', [auth.connectionId, input.idempotency_key]);
    if (existingRows.length) {
      const existing = existingRows[0];
      if (existing.request_hash !== requestHash) throw identity.denied('IDEMPOTENCY_KEY_REUSED', 409);
      let result = existing.result_json;
      if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) { result = null; } }
      if (!result) throw identity.denied('IDEMPOTENCY_IN_PROGRESS', 409);
      await db.commit();
      return { ...result, replayed: true };
    }
    await db.query('INSERT INTO mcp_tool_idempotency(connection_id,idempotency_key,request_hash,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))', [auth.connectionId, input.idempotency_key, requestHash]);
    const result = await taskManagement.create(db, ctx, {
      title: request.title,
      description: request.description,
      taskType: 'lead_follow_up',
      priority: request.priority,
      dueAt: request.dueAt,
      source: { type: 'lead', id: request.leadId },
      participants: [{ actorType: ctx.actorType, actorId: String(ctx.actorId), role: 'assignee' }],
    }, { manageTransaction: false });
    const response = {
      taskId: result.id,
      title: result.title,
      status: result.status,
      revision: result.revision,
      dueAt: result.dueAt,
      leadId: request.leadId,
      replayed: false,
    };
    await db.query('UPDATE mcp_tool_idempotency SET result_json=? WHERE connection_id=? AND idempotency_key=?', [JSON.stringify(response), auth.connectionId, input.idempotency_key]);
    await oauth.audit(db, { connectionId: auth.connectionId, clientId: auth.clientId, eventType: 'tool_called', toolName: 'create_follow_up_task', resourceId: request.leadId, outcome: 'success' });
    await db.commit();
    return response;
  } catch (error) {
    try { await db.rollback(); } catch (_) {}
    if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) {
      const [rows] = await pool().query('SELECT request_hash,result_json FROM mcp_tool_idempotency WHERE connection_id=? AND idempotency_key=? LIMIT 1', [auth.connectionId, input.idempotency_key]);
      const row = rows[0];
      let result = row?.result_json;
      if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) { result = null; } }
      if (!row || row.request_hash !== requestHash) throw identity.denied('IDEMPOTENCY_KEY_REUSED', 409);
      if (!result) throw identity.denied('IDEMPOTENCY_IN_PROGRESS', 409);
      return { ...result, replayed: true };
    }
    throw error;
  } finally { db.release(); }
}

async function updateTaskStatus(actor, input) {
  const ctx = await identity.taskContext(actor, 'tasks.manage');
  if (!ctx) throw identity.denied('PERMISSION_DENIED');
  const db = await pool().getConnection();
  try {
    const result = await taskManagement.updateStatus(db, ctx, input.task_id, { status: input.status, expectedRevision: input.expected_revision, comment: input.comment });
    return { taskId: result.id, status: result.status, revision: result.revision, unchanged: Boolean(result.unchanged) };
  } finally { db.release(); }
}

function createMcpServer(auth) {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({ name: '7Network', version: '1.0.0' }, { maxToolInputElements: 48 });

  if (hasScope(auth, 'pipeline.read')) {
    server.registerTool('search_pipeline_leads', {
      title: 'Search 7Network leads',
      description: 'Search the connected user’s permitted 7Network pipeline leads by title or customer/learner name. Returns a bounded, tenant-scoped result without phone numbers or message history.',
      inputSchema: { query: z.string().min(2).max(80), status: z.enum(['open', 'all']).optional(), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => runTool(auth, 'search_pipeline_leads', 'pipeline.read', null, () => searchLeads(auth.actor, args)));

    server.registerTool('get_pipeline_follow_ups', {
      title: 'Review 7Network follow-ups',
      description: 'List the connected user’s permitted open lead follow-ups. Use overdue or upcoming to focus the result; output omits phone numbers and conversation transcripts.',
      inputSchema: { period: z.enum(['all', 'overdue', 'upcoming']).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => runTool(auth, 'get_pipeline_follow_ups', 'pipeline.read', null, () => listFollowUps(auth.actor, args)));
  }

  if (hasScope(auth, 'tasks.read')) {
    server.registerTool('list_follow_up_tasks', {
      title: 'List 7Network tasks',
      description: 'List active or completed follow-up tasks visible to the connected user. Team scope is allowed only when the current 7Network role permits it.',
      inputSchema: { status: z.enum(['active', 'open', 'in_progress', 'blocked', 'completed', 'all']).optional(), scope: z.enum(['mine', 'team']).optional(), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => runTool(auth, 'list_follow_up_tasks', 'tasks.read', null, () => listTasks(auth.actor, args)));
  }

  if (hasScope(auth, 'tasks.manage')) {
    server.registerTool('create_follow_up_task', {
      title: 'Create a 7Network follow-up task',
      description: 'Create a task assigned to the connected user for an existing lead. Requires a unique idempotency_key. This does not contact the customer. Existing 7Network task notification rules may notify the assigned account.',
      inputSchema: {
        lead_id: uuid,
        title: z.string().trim().min(1).max(180),
        description: z.string().max(1000).optional(),
        due_at: z.string().min(20).max(35),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => runTool(auth, 'create_follow_up_task', 'tasks.manage', args.lead_id, () => createFollowUpTask(auth.actor, auth, args), { auditSuccess: false }));

    server.registerTool('update_follow_up_task_status', {
      title: 'Update a 7Network task status',
      description: 'Change the status of a permitted task. Pass the revision returned by list_follow_up_tasks; stale updates are rejected.',
      inputSchema: { task_id: uuid, status: z.enum(['open', 'in_progress', 'blocked', 'completed', 'canceled']), expected_revision: z.number().int().min(1), comment: z.string().max(500).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => runTool(auth, 'update_follow_up_task_status', 'tasks.manage', args.task_id, () => updateTaskStatus(auth.actor, args)));
  }

  return server;
}

module.exports = { createMcpServer, searchLeads, listFollowUps, listTasks, createFollowUpTask, updateTaskStatus, hasScope };
