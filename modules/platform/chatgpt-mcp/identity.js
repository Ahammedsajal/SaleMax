'use strict';

const crypto = require('node:crypto');
const { promise: pool } = require('../../../database/config');
const pipelineActorResolver = require('../legacy-pipeline-actor');
const businessFeatureSession = require('../business-feature-session');
const createTaskContext = require('../training-task-context').createTaskContext;

const hash = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const denied = (code, status = 403) => Object.assign(new Error(code), { code, status });

function sourceTableFor(agent) { return agent ? 'agents' : 'user'; }

async function resolveActor(sourceTable, sourceId) {
  if (!['user', 'agents'].includes(sourceTable) || !/^\d{1,20}$/.test(String(sourceId))) throw denied('ACCOUNT_NOT_AVAILABLE', 401);
  const isAgent = sourceTable === 'agents';
  const table = isAgent ? 'agents' : 'user';
  const id = Number(sourceId);
  const [rows] = await pool().query(
    `SELECT id,uid,email,role,timezone${isAgent ? ',owner_uid,is_active' : ''} FROM ${table} WHERE id=? LIMIT 2`,
    [id],
  );
  if (rows.length !== 1) throw denied('ACCOUNT_NOT_AVAILABLE', 401);
  const rawActor = rows[0];
  let pipelineActor = null;

  if (process.env.SALEMAX_PLATFORM_ENABLED === 'true') {
    pipelineActor = isAgent
      ? await pipelineActorResolver.resolveAgent(pool(), rawActor)
      : await pipelineActorResolver.resolve(pool(), rawActor);
    if (pipelineActor?.denied) throw denied(pipelineActor.code || 'BUSINESS_ACCESS_INACTIVE');
  }

  if (isAgent) {
    if (rawActor.role !== 'agent' || Number(rawActor.is_active) !== 1) throw denied('ACCOUNT_NOT_AVAILABLE', 401);
    const [owners] = await pool().query('SELECT uid,timezone FROM user WHERE uid=? AND role=\'user\' LIMIT 2', [rawActor.owner_uid]);
    if (owners.length !== 1) throw denied('BUSINESS_LINK_INVALID');
    if (pipelineActor?.canonicalContext) {
      if (pipelineActor.role !== 'agent') throw denied('PERMISSION_DENIED');
    } else if (process.env.SALEMAX_PLATFORM_ENABLED === 'true') {
      throw denied('BUSINESS_LINK_INVALID');
    }
    if (!pipelineActor) {
      pipelineActor = {
        uid: owners[0].uid,
        role: 'agent',
        actorType: 'agent',
        actorId: String(rawActor.id),
        agentId: Number(rawActor.id),
        timezone: owners[0].timezone || 'Asia/Qatar',
      };
    }
  } else {
    if (rawActor.role !== 'user') throw denied('ACCOUNT_NOT_AVAILABLE', 401);
    if (pipelineActor && !pipelineActor.canonicalContext && !pipelineActorResolver.canUsePipeline(pipelineActor)) throw denied('FEATURE_UNAVAILABLE');
    if (pipelineActor?.canonicalContext && !pipelineActorResolver.canUsePipeline(pipelineActor)) throw denied('PERMISSION_DENIED');
    if (!pipelineActor) {
      pipelineActor = {
        uid: rawActor.uid,
        role: 'owner',
        actorType: 'user',
        actorId: String(rawActor.uid),
        timezone: rawActor.timezone || 'Asia/Qatar',
      };
    }
  }

  const businessSession = await businessFeatureSession.legacyContext(pool(), rawActor, isAgent);
  const tenantId = businessSession?.tenant?.id || pipelineActor.tenantId || null;
  const identityId = businessSession?.identity?.id || pipelineActor.identityId || null;
  const ownerUid = pipelineActor.uid || (isAgent ? rawActor.owner_uid : rawActor.uid);

  const canReadPipeline = isAgent
    ? pipelineActor.role === 'agent' && (Boolean(pipelineActor.canonicalContext) || process.env.SALEMAX_PLATFORM_ENABLED !== 'true')
    : pipelineActorResolver.canUsePipeline(pipelineActor) || pipelineActor.role === 'owner';
  if (!ownerUid || !canReadPipeline) {
    throw denied('PERMISSION_DENIED');
  }

  return {
    sourceTable,
    sourceId: String(rawActor.id),
    rawActor,
    agent: isAgent,
    ownerUid,
    uidHash: hash(ownerUid),
    tenantId: tenantId ? String(tenantId) : null,
    identityId: identityId ? String(identityId) : null,
    role: pipelineActor.role,
    timezone: pipelineActor.timezone || 'Asia/Qatar',
    pipelineActor,
    businessContext: businessSession || pipelineActor.canonicalContext || null,
  };
}

async function actorFromFeatureSession(session) {
  if (!session?.actor?.id) throw denied('ACCOUNT_NOT_AVAILABLE', 401);
  return resolveActor(sourceTableFor(session.agent), session.actor.id);
}

async function taskContext(actor, permission) {
  if (!actor?.businessContext) return null;
  try { return await createTaskContext(pool(), actor.businessContext, permission); }
  catch (error) {
    if (['PERMISSION_DENIED', 'FEATURE_UNAVAILABLE', 'CATEGORY_UNAVAILABLE', 'BUSINESS_ACCESS_INACTIVE', 'TENANT_CONTEXT_REQUIRED'].includes(error?.code)) return null;
    throw error;
  }
}

async function allowedScopes(actor) {
  const scopes = new Set(['pipeline.read']);
  if (await taskContext(actor, 'tasks.read')) scopes.add('tasks.read');
  if (await taskContext(actor, 'tasks.manage')) scopes.add('tasks.manage');
  return scopes;
}

async function actorForConnection(connection) {
  const actor = await resolveActor(connection.source_table, connection.source_id);
  if (actor.uidHash !== connection.legacy_uid_hash
      || String(actor.tenantId || '') !== String(connection.tenant_id || '')
      || String(actor.identityId || '') !== String(connection.identity_id || '')) {
    throw denied('BUSINESS_ACCESS_CHANGED');
  }
  return actor;
}

module.exports = { resolveActor, actorFromFeatureSession, actorForConnection, allowedScopes, taskContext, hash, denied };
