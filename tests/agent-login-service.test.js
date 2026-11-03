'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentLoginService } = require('../modules/platform/agent-login-service');

function fixture(overrides = {}) {
  const writes = [];
  const agent = { id: 19, uid: 'agent-uid', owner_uid: 'owner-uid', email: 'agent@example.test', password: 'hash', is_active: 1, logs: null };
  const dependencies = {
    query: async (sql, values) => {
      if (sql.startsWith('SELECT')) return overrides.rows === undefined ? [agent] : overrides.rows;
      writes.push({ sql, values });
      return { affectedRows: 1 };
    },
    bcrypt: { compare: async (password, hash) => password === 'correct' && hash === 'hash' },
    sign: payload => `signed:${payload.role}`,
    issueForVerifiedLegacyAccount: async () => ({ token: 'cookie-token', context: { actor: 'agent' }, csrfToken: 'csrf', maxAgeSeconds: 60, cookieName: 'session', cookie: { httpOnly: true } }),
    assertLegacyHost: async () => {},
    jwtKey: () => 'unit-test-key',
    now: () => new Date('2026-11-03T10:00:00.000Z'),
    ...overrides.dependencies,
  };
  const req = { socket: { remoteAddress: '127.0.0.1' }, get: key => key === 'Origin' ? 'https://7network.live' : undefined, crmTenantDomain: null };
  return { login: createAgentLoginService(dependencies), req, writes, agent };
}

test('shared credential resolver authenticates an active agent and returns a role-specific token/session', async () => {
  const f = fixture();
  const result = await f.login({ req: f.req, email: 'agent@example.test', password: 'correct' });

  assert.equal(result.success, true);
  assert.equal(result.token, 'signed:agent');
  assert.equal(result.businessSession.context.actor, 'agent');
  assert.equal(result.todayStats.logins, 1);
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0].sql, /UPDATE agents SET logs/);
});

test('invalid credentials never issue a session or update agent login logs', async () => {
  let sessionIssued = false;
  const f = fixture({ dependencies: { issueForVerifiedLegacyAccount: async () => { sessionIssued = true; } } });
  const result = await f.login({ req: f.req, email: 'agent@example.test', password: 'wrong' });

  assert.equal(result.success, false);
  assert.equal(result.msg, 'Invalid credentials');
  assert.equal(sessionIssued, false);
  assert.equal(f.writes.length, 0);
});

test('inactive agents are denied before session creation', async () => {
  let sessionIssued = false;
  const f = fixture({ dependencies: {
    query: async sql => sql.startsWith('SELECT') ? [{ ...f.agent, is_active: 0 }] : { affectedRows: 1 },
    issueForVerifiedLegacyAccount: async () => { sessionIssued = true; },
  } });
  const result = await f.login({ req: f.req, email: 'agent@example.test', password: 'correct' });

  assert.equal(result.status, 403);
  assert.equal(result.code, 'AGENT_INACTIVE');
  assert.equal(sessionIssued, false);
});

test('tenant host mismatches fail closed before issuing the agent session', async () => {
  let sessionIssued = false;
  const f = fixture({ dependencies: {
    assertLegacyHost: async () => { throw Object.assign(new Error('wrong tenant'), { status: 403, code: 'CRM_DOMAIN_TENANT_MISMATCH' }); },
    issueForVerifiedLegacyAccount: async () => { sessionIssued = true; },
  } });
  const result = await f.login({ req: f.req, email: 'agent@example.test', password: 'correct' });

  assert.equal(result.status, 403);
  assert.equal(result.code, 'CRM_DOMAIN_TENANT_MISMATCH');
  assert.equal(sessionIssued, false);
});
