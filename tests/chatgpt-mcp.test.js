'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const fakePool = { query: async () => [[], []] };
const dbConfigPath = require.resolve('../database/config');
require.cache[dbConfigPath] = {
  id: dbConfigPath,
  filename: dbConfigPath,
  loaded: true,
  exports: { promise: () => fakePool },
};

const express = require('express');
const identity = require('../modules/platform/chatgpt-mcp/identity');
const oauth = require('../modules/platform/chatgpt-mcp/oauth');
const tools = require('../modules/platform/chatgpt-mcp/tools');
const workspaceRouter = require('../modules/platform/chatgpt-mcp/workspace-router');
const shell = require('../modules/web/chatgpt-mcp-shell');

async function withServer(router, callback) {
  const app = express();
  app.use(router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await callback(base); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('OAuth accepts only exact ChatGPT connector callback URLs', () => {
  assert.equal(oauth.isChatGptRedirect('https://chatgpt.com/connector/oauth/abc_123'), true);
  assert.equal(oauth.isChatGptRedirect('https://chat.openai.com/connector/oauth/abc-123'), true);
  for (const value of [
    'https://chatgpt.com.evil.example/connector/oauth/abc',
    'https://chatgpt.com/connector/oauth/abc?next=https://evil.example',
    'https://chatgpt.com/connector/oauth/abc#fragment',
    'https://chatgpt.com:443/connector/oauth/abc',
    'http://chatgpt.com/connector/oauth/abc',
    'https://chatgpt.com/connector/oauth/../admin',
    'https://user@chatgpt.com/connector/oauth/abc',
  ]) assert.equal(oauth.isChatGptRedirect(value), false, value);
});

test('OAuth origin requires HTTPS outside loopback and scope parsing is bounded to known values', () => {
  assert.equal(oauth.publicOrigin('https://7network.live/'), 'https://7network.live');
  assert.throws(() => oauth.publicOrigin('http://7network.live'), /MCP_HTTPS_REQUIRED/);
  assert.equal(oauth.publicOrigin('http://127.0.0.1:3010/'), 'http://127.0.0.1:3010');
  assert.deepEqual(oauth.splitScopes('pipeline.read tasks.read pipeline.read'), ['pipeline.read', 'tasks.read']);
  assert.equal(oauth.resourceUri('https://7network.live'), 'https://7network.live/mcp');
});

test('dynamic client registration accepts ChatGPT redirects and rejects lookalike domains', async () => {
  const inserted = [];
  const clients = new Map();
  const transactions = [];
  const db = {
    query: async (sql, values) => {
      if (sql.startsWith('INSERT INTO mcp_oauth_clients')) {
        inserted.push(values);
        clients.set(values[0], { client_id: values[0], client_name: values[1], client_uri: values[2], redirect_uris: JSON.parse(values[3]) });
      }
      if (sql.includes('FROM mcp_oauth_clients WHERE client_id=?')) return [[clients.get(values[0])].filter(Boolean), []];
      if (sql.startsWith('INSERT INTO mcp_oauth_authorization_transactions')) transactions.push(values);
      if (sql.includes('FROM mcp_oauth_authorization_transactions') && sql.includes('transaction_hash=?')) {
        return [transactions.some(row => row[0] === values[0]) ? [{ transaction_hash: values[0] }] : [], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const { router } = oauth.createOAuthRouter({ db, origin: 'https://7network.live' });
  await withServer(router, async base => {
    const valid = await fetch(`${base}/mcp/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector/oauth/abc123'] }),
    });
    assert.equal(valid.status, 201);
    const registration = await valid.json();
    assert.match(registration.client_id, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(registration.grant_types, ['authorization_code', 'refresh_token']);
    assert.equal(inserted.length, 1);

    const authorization = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0],
      response_type: 'code',
      state: 'synthetic-state-value',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      scope: 'pipeline.read tasks.manage offline_access',
      resource: 'https://7network.live/mcp',
    });
    const start = await fetch(`${base}/mcp/oauth/authorize?${authorization}`, { redirect: 'manual' });
    assert.equal(start.status, 303);
    const consentUrl = new URL(start.headers.get('location'), base);
    assert.equal(consentUrl.pathname, '/mcp/oauth/authorize');
    assert.match(consentUrl.searchParams.get('tx'), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(consentUrl.searchParams.has('state'), false, 'OAuth state and PKCE data are removed from the consent page URL');
    const consent = await fetch(consentUrl);
    assert.equal(consent.status, 200);
    assert.match(await consent.text(), /chatgpt-oauth\.js/);

    const invalid = await fetch(`${base}/mcp/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://chatgpt.com.attacker.invalid/connector/oauth/abc123'] }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(inserted.length, 1);
  });
});

test('OAuth client registration has a bounded retry window', () => {
  let now = 1_000;
  let nextCalls = 0;
  const middleware = oauth.createClientRegistrationLimiter({ limit: 1, windowMs: 1_000, now: () => now });
  const response = () => ({
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  });
  middleware({ ip: '192.0.2.1' }, response(), () => nextCalls++);
  const limited = response();
  middleware({ ip: '192.0.2.1' }, limited, () => nextCalls++);
  assert.equal(nextCalls, 1);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '1');
  middleware({ ip: '192.0.2.2' }, response(), () => nextCalls++);
  assert.equal(nextCalls, 2, 'one client cannot rate-limit other source addresses');
  now += 1_000;
  middleware({ ip: '192.0.2.1' }, response(), () => nextCalls++);
  assert.equal(nextCalls, 3);
});

test('token authentication rechecks the current account permissions', async () => {
  const originalActor = identity.actorForConnection;
  const originalScopes = identity.allowedScopes;
  const actor = { uidHash: 'a'.repeat(64), role: 'owner' };
  const row = {
    token_hash: 'b'.repeat(64), scope_text: 'pipeline.read', resource_uri: 'https://7network.live/mcp',
    expires_at: new Date(Date.now() + 60_000), revoked_at: null, connection_id: 'connection-id',
    client_id: 'client-id', source_table: 'user', source_id: '1', identity_id: null,
    tenant_id: null, legacy_uid_hash: actor.uidHash, connection_revoked: null,
  };
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      return sql.startsWith('SELECT t.token_hash') ? [[row], []] : [{ affectedRows: 1 }, []];
    },
  };
  identity.actorForConnection = async () => actor;
  identity.allowedScopes = async () => new Set(['pipeline.read']);
  try {
    const auth = await oauth.authenticateAccess(db, 'x'.repeat(43), 'https://7network.live/mcp');
    assert.equal(auth.actor, actor);
    assert.equal(auth.scopes.has('pipeline.read'), true);
    identity.allowedScopes = async () => new Set();
    await assert.rejects(oauth.authenticateAccess(db, 'x'.repeat(43), 'https://7network.live/mcp'), { code: 'BUSINESS_ACCESS_CHANGED' });
    assert.ok(queries.some(sql => sql.includes('UPDATE mcp_oauth_connections SET last_used_at')));
  } finally {
    identity.actorForConnection = originalActor;
    identity.allowedScopes = originalScopes;
  }
});

test('OAuth revocation joins token rows to their owning client connection', async () => {
  const statements = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async sql => {
      statements.push(sql);
      if (sql.includes('SELECT t.token_family_id')) return [[{ token_family_id: 'family-id', connection_id: 'connection-id', client_id: 'client-id' }], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  const db = { getConnection: async () => connection, query: async () => [[], []] };
  const { router } = oauth.createOAuthRouter({ db, origin: 'https://7network.live' });
  await withServer(router, async base => {
    const response = await fetch(`${base}/mcp/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'x'.repeat(43), client_id: 'client-id' }),
    });
    assert.equal(response.status, 200);
    assert.match(statements[0], /JOIN mcp_oauth_connections c ON c\.id=t\.connection_id/);
    assert.ok(statements.some(sql => sql.includes('UPDATE mcp_oauth_connections SET revoked_at')));
  });
});

test('MCP endpoint advertises OAuth metadata and rejects unauthenticated tool calls', async () => {
  const { createRouter } = require('../modules/platform/chatgpt-mcp/server');
  const router = createRouter({ db: fakePool, origin: 'https://7network.live' });
  await withServer(router, async base => {
    const discovery = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(discovery.status, 200);
    assert.deepEqual((await discovery.json()).authorization_servers, ['https://7network.live']);

    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /\.well-known\/oauth-protected-resource\/mcp/);
  });
});

test('ChatGPT connection settings use the shared pool option supplied by the business workspace mount', async () => {
  const originalActor = identity.actorFromFeatureSession;
  const originalScopes = identity.allowedScopes;
  let queried = false;
  const pool = {
    query: async sql => {
      assert.match(sql, /FROM mcp_oauth_connections c JOIN mcp_oauth_clients cl/);
      queried = true;
      return [[], []];
    },
  };
  identity.actorFromFeatureSession = async () => ({ uidHash: 'synthetic-account', tenantId: 'synthetic-tenant' });
  identity.allowedScopes = async () => new Set(['pipeline.read']);
  try {
    const router = workspaceRouter.createWorkspaceRouter({
      pool,
      sessionGuard: (req, _res, next) => { req.featureSession = { actor: { id: 1 } }; next(); },
      origin: 'https://7network.live',
    });
    await withServer(router, async base => {
      const response = await fetch(`${base}/connections`);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.data.eligible, true);
      assert.deepEqual(result.data.connections, []);
      assert.equal(result.data.endpoint, 'https://7network.live/mcp');
      assert.equal(queried, true);
    });
  } finally {
    identity.actorFromFeatureSession = originalActor;
    identity.allowedScopes = originalScopes;
  }
});

test('MCP tool catalog follows only the granted scopes', async () => {
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  async function listFor(scopes) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'synthetic-client', version: '1' });
    const server = tools.createMcpServer({ scopes: new Set(scopes), connectionId: 'synthetic', clientId: 'synthetic', actor: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      return (await client.listTools()).tools.map(tool => tool.name).sort();
    } finally {
      await client.close();
      await server.close();
    }
  }
  assert.deepEqual(await listFor(['pipeline.read']), ['get_pipeline_follow_ups', 'search_pipeline_leads']);
  assert.deepEqual(await listFor(['tasks.manage']), ['create_follow_up_task', 'update_follow_up_task_status']);
  assert.deepEqual(await listFor(['tasks.read', 'tasks.manage']), ['create_follow_up_task', 'list_follow_up_tasks', 'update_follow_up_task_status']);
});

test('lead search binds tenant and assigned-agent scope and omits phone and chat identifiers', async () => {
  let statement = '';
  let values = [];
  fakePool.query = async (sql, parameters) => {
    statement = sql;
    values = parameters;
    return [[{ leadId: 'synthetic-lead', title: 'Excel course enquiry' }], []];
  };
  const result = await tools.searchLeads({
    uidHash: 'a'.repeat(64),
    pipelineActor: { role: 'agent', agentId: 17 },
  }, { query: 'Excel', status: 'all', limit: 9 });
  assert.match(statement, /l\.uid_hash=\?/);
  assert.match(statement, /l\.owner_agent_id=\?/);
  assert.equal(values[0], 'a'.repeat(64));
  assert.equal(values[1], 17);
  assert.doesNotMatch(statement, /l\.mobile|l\.chat_id|conversation/i);
  assert.equal(result.items[0].leadId, 'synthetic-lead');
});

test('business login return survives the login redirect and remains same-origin', () => {
  const source = fs.readFileSync(path.join(__dirname, '../client/public/chatgpt-mcp-login-return.js'), 'utf8');
  const memory = initial => {
    const values = new Map(Object.entries(initial || {}));
    return {
      values,
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    };
  };
  const sessionStorage = memory();
  const localStorage = memory({ wacrm_user: 'stale-token' });
  let forceReload = false;
  const target = '/mcp/oauth/authorize?tx=' + 'A'.repeat(43) + '&actor=user';
  function run(pathname, search) {
    let tick;
    const redirects = [];
    const location = {
      origin: 'https://7network.live', pathname, search,
      reload: () => { forceReload = true; },
      replace: value => redirects.push(value),
    };
    const context = {
      URL, URLSearchParams, Date, location, sessionStorage, localStorage,
      history: { state: null, replaceState() {} },
      window: { setInterval: callback => { tick = callback; return 1; }, clearInterval() {} },
    };
    vm.runInNewContext(source, context);
    return { tick: () => tick?.(), redirects };
  }
  run('/user/login', `?mcp_actor=user&mcp_force_login=1&mcp_return=${encodeURIComponent(target)}`);
  assert.equal(forceReload, true);
  assert.equal(localStorage.getItem('wacrm_user'), null);
  assert.ok(sessionStorage.getItem('7network.mcp.oauthReturn'));
  localStorage.setItem('wacrm_user', 'fresh-token');
  const resumed = run('/user', '');
  resumed.tick();
  assert.equal(resumed.redirects[0], target);

  const unsafe = memory();
  vm.runInNewContext(source, {
    URL, URLSearchParams, Date,
    location: { origin: 'https://7network.live', pathname: '/user/login', search: `?mcp_return=${encodeURIComponent('https://evil.invalid/mcp/oauth/authorize?tx=abc&actor=user')}` },
    sessionStorage: unsafe, localStorage: memory(), history: { replaceState() {} },
    window: { setInterval: () => 1, clearInterval() {} },
  });
  assert.equal(unsafe.getItem('7network.mcp.oauthReturn'), null);
});

test('ChatGPT integration shell remains inside existing business routes', () => {
  assert.equal(shell.isBusinessShellPath('/user'), true);
  assert.equal(shell.isBusinessShellPath('/agent/login'), true);
  assert.equal(shell.isBusinessShellPath('/admin'), false);
  const html = shell.injectChatGPTWorkspace('<html><head></head><body></body></html>');
  assert.match(html, /chatgpt-mcp-workspace\.js/);
  assert.equal(shell.injectChatGPTWorkspace(html), html);
});

test('ChatGPT OAuth consent lets a dual-signed-in user choose owner or agent identity', () => {
  const page = fs.readFileSync(path.join(__dirname, '../client/public/chatgpt-oauth.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../client/public/chatgpt-oauth.js'), 'utf8');
  assert.match(page, /id="account-switch"/);
  assert.match(page, /id="switch-user"/);
  assert.match(page, /id="switch-agent"/);
  assert.match(script, /localStorage\.getItem\('wacrm_user'\) && localStorage\.getItem\('wacrm_agent'\)/);
  assert.match(script, /selectedActor = 'agent'; initialize\(\)/);
  assert.match(script, /selectedActor = 'user'; initialize\(\)/);
});
