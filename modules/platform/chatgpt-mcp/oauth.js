'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const identity = require('./identity');

const BUSINESS_SCOPES = ['pipeline.read', 'conversations.read', 'tasks.read', 'tasks.manage'];
const ALL_SCOPES = [...BUSINESS_SCOPES, 'offline_access'];
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODE_TTL_SECONDS = 90;
const TRANSACTION_TTL_SECONDS = 10 * 60;
const sha = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const splitScopes = value => [...new Set(String(value || '').split(/\s+/).filter(Boolean))];
const isoTime = seconds => new Date(Date.now() + seconds * 1000);
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const oauthError = (status, error, description) => Object.assign(new Error(description || error), { status, oauthError: error });

function publicOrigin(value) {
  const candidate = value || process.env.MCP_PUBLIC_ORIGIN || 'https://7network.live';
  let url;
  try { url = new URL(candidate); } catch (_) { throw new Error('MCP_PUBLIC_ORIGIN_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MCP_PUBLIC_ORIGIN_INVALID');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('MCP_HTTPS_REQUIRED');
  return url.origin;
}

function resourceUri(origin) { return new URL('/mcp', origin).toString(); }
function isChatGptRedirect(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const authority = value.slice('https://'.length).split('/', 1)[0];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && authority.toLowerCase() === url.hostname
      && ['chatgpt.com', 'chat.openai.com'].includes(url.hostname)
      && /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname);
  } catch (_) { return false; }
}

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function createClientRegistrationLimiter({ limit = 60, windowMs = 60_000, now = Date.now, description = 'This request is temporarily rate limited.' } = {}) {
  const buckets = new Map();
  return (_req, res, next) => {
    const current = now();
    const key = String(_req.ip || _req.socket?.remoteAddress || 'unknown').slice(0, 96);
    let bucket = buckets.get(key);
    if (!bucket && buckets.size >= 10_000) {
      for (const [address, entry] of buckets) if (current - entry.startedAt >= windowMs) buckets.delete(address);
      if (buckets.size >= 10_000) {
        setNoStore(res);
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(windowMs / 1000))));
        return res.status(429).json({ error: 'temporarily_unavailable', error_description: description });
      }
    }
    if (!bucket || current - bucket.startedAt >= windowMs) {
      bucket = { startedAt: current, count: 0 };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      setNoStore(res);
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowMs - (current - bucket.startedAt)) / 1000))));
      return res.status(429).json({ error: 'temporarily_unavailable', error_description: description });
    }
    bucket.count += 1;
    return next();
  };
}

function parseClientRedirects(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 || value.some(uri => !isChatGptRedirect(uri))) {
    throw oauthError(400, 'invalid_redirect_uri', 'Only the registered ChatGPT OAuth callback URL is supported.');
  }
  return [...new Set(value)];
}

async function registerClient(db, metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw oauthError(400, 'invalid_client_metadata');
  const redirects = parseClientRedirects(metadata.redirect_uris);
  if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') throw oauthError(400, 'invalid_client_metadata');
  if (metadata.grant_types && (!Array.isArray(metadata.grant_types) || metadata.grant_types.some(value => !['authorization_code', 'refresh_token'].includes(value)))) throw oauthError(400, 'invalid_client_metadata');
  if (metadata.response_types && (!Array.isArray(metadata.response_types) || metadata.response_types.some(value => value !== 'code'))) throw oauthError(400, 'invalid_client_metadata');
  const name = typeof metadata.client_name === 'string' && metadata.client_name.trim()
    ? metadata.client_name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
    : 'ChatGPT';
  const clientUri = typeof metadata.client_uri === 'string' && metadata.client_uri.length <= 512 && /^https:\/\//i.test(metadata.client_uri)
    ? metadata.client_uri
    : null;
  const clientId = randomToken(32);
  await db.query('INSERT INTO mcp_oauth_clients(client_id,client_name,client_uri,redirect_uris) VALUES(?,?,?,?)', [clientId, name || 'ChatGPT', clientUri, JSON.stringify(redirects)]);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name || 'ChatGPT',
    ...(clientUri ? { client_uri: clientUri } : {}),
    redirect_uris: redirects,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

async function getClient(db, clientId) {
  if (typeof clientId !== 'string' || clientId.length > 128) return null;
  const [rows] = await db.query('SELECT * FROM mcp_oauth_clients WHERE client_id=? LIMIT 1', [clientId]);
  if (!rows.length) return null;
  let redirects = [];
  try { redirects = Array.isArray(rows[0].redirect_uris) ? rows[0].redirect_uris : JSON.parse(rows[0].redirect_uris); } catch (_) {}
  return { ...rows[0], redirect_uris: redirects };
}

async function audit(db, values) {
  const details = values.details ? JSON.stringify(values.details) : null;
  await db.query(
    'INSERT INTO mcp_oauth_events(connection_id,client_id,event_type,tool_name,resource_id,outcome,details_json) VALUES(?,?,?,?,?,?,?)',
    [values.connectionId || null, values.clientId || null, values.eventType, values.toolName || null, values.resourceId || null, values.outcome || 'success', details],
  );
}

function authorizeRedirect(row, code, origin) {
  const callback = new URL(row.redirect_uri);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', row.state_value);
  callback.searchParams.set('iss', origin);
  return callback.toString();
}

async function createConnectionForSession(db, actor, clientId, grantedScopes) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO mcp_oauth_connections
      (id,client_id,source_table,source_id,identity_id,tenant_id,legacy_uid_hash,actor_role,scope_text)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [id, clientId, actor.sourceTable, actor.sourceId, actor.identityId, actor.tenantId, actor.uidHash, actor.role, grantedScopes.join(' ')],
  );
  return id;
}

async function issueTokenRows(db, connectionId, familyId, scopeText, resource, withRefresh = true) {
  const accessToken = randomToken(32);
  const accessExpiry = isoTime(ACCESS_TTL_SECONDS);
  await db.query(
    `INSERT INTO mcp_oauth_tokens(token_hash,connection_id,token_family_id,token_type,resource_uri,scope_text,expires_at)
     VALUES(?,?,?,'access',?,?,?)`,
    [sha(accessToken), connectionId, familyId, resource, scopeText, accessExpiry],
  );
  const result = { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, scope: scopeText };
  if (withRefresh) {
    const refreshToken = randomToken(48);
    const refreshExpiry = isoTime(REFRESH_TTL_SECONDS);
    await db.query(
      `INSERT INTO mcp_oauth_tokens(token_hash,connection_id,token_family_id,token_type,resource_uri,scope_text,expires_at)
       VALUES(?,?,?,'refresh',?,?,?)`,
      [sha(refreshToken), connectionId, familyId, resource, scopeText, refreshExpiry],
    );
    result.refresh_token = refreshToken;
  }
  return result;
}

function responseError(res, error) {
  setNoStore(res);
  const status = Number(error?.status) || 500;
  const value = error?.oauthError || (status >= 500 ? 'server_error' : 'invalid_request');
  if (status >= 500) console.error('7Network MCP OAuth request failed:', error?.code || error?.name || 'unknown');
  return res.status(status).json({ error: value, ...(status < 500 ? { error_description: error.message } : {}) });
}

function createOAuthRouter({ db, origin = publicOrigin() }) {
  const router = express.Router();
  const resource = resourceUri(origin);
  const metadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/oauth/authorize`,
    token_endpoint: `${origin}/mcp/oauth/token`,
    registration_endpoint: `${origin}/mcp/oauth/register`,
    revocation_endpoint: `${origin}/mcp/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ALL_SCOPES,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
  router.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'MCP-Session-Id'], exposedHeaders: ['WWW-Authenticate', 'MCP-Session-Id'], maxAge: 600 }));
  router.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(metadata));
  const protectedResource = {
    resource,
    authorization_servers: [origin],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
  };
  router.get('/.well-known/oauth-protected-resource', (_req, res) => res.json(protectedResource));
  router.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => res.json(protectedResource));

  router.post('/mcp/oauth/register', createClientRegistrationLimiter(), express.json({ limit: '16kb', strict: true }), async (req, res) => {
    try {
      setNoStore(res);
      return res.status(201).json(await registerClient(db, req.body));
    } catch (error) { return responseError(res, error); }
  });

  router.get('/mcp/oauth/authorize', createClientRegistrationLimiter({ limit: 120, description: 'Authorization requests are temporarily rate limited.' }), async (req, res) => {
    try {
      if (Object.hasOwn(req.query, 'tx')) {
        const transactionId = req.query.tx;
        if (typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(transactionId)) {
          throw oauthError(400, 'invalid_request', 'The authorization transaction is invalid.');
        }
        const [transactions] = await db.query(
          `SELECT transaction_hash FROM mcp_oauth_authorization_transactions
           WHERE transaction_hash=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP(3) LIMIT 1`, [sha(transactionId)],
        );
        if (!transactions.length) throw oauthError(400, 'invalid_request', 'The authorization transaction expired or was already used.');
        setNoStore(res);
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        return res.sendFile(path.resolve(__dirname, '../../../client/public/chatgpt-oauth.html'));
      }

      const client = await getClient(db, req.query.client_id);
      const redirectUri = req.query.redirect_uri;
      if (!client || !client.redirect_uris.includes(redirectUri) || !isChatGptRedirect(redirectUri)) throw oauthError(400, 'invalid_request', 'The OAuth client or callback URL is not registered.');
      if (req.query.response_type !== 'code' || typeof req.query.state !== 'string' || !req.query.state || req.query.state.length > 1024) throw oauthError(400, 'invalid_request', 'A code response and state are required.');
      if (req.query.code_challenge_method !== 'S256' || typeof req.query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(req.query.code_challenge)) throw oauthError(400, 'invalid_request', 'PKCE with S256 is required.');
      const requested = req.query.scope ? splitScopes(req.query.scope) : ['pipeline.read', 'tasks.read'];
      if (!requested.length || requested.some(scope => !ALL_SCOPES.includes(scope))) throw oauthError(400, 'invalid_scope', 'The requested access scope is not supported.');
      if (req.query.resource && req.query.resource !== resource) throw oauthError(400, 'invalid_target', 'The requested resource does not match this MCP server.');
      const transactionId = randomToken(32);
      await db.query(
        `INSERT INTO mcp_oauth_authorization_transactions
          (transaction_hash,client_id,redirect_uri,state_value,resource_uri,scope_text,code_challenge,expires_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        [sha(transactionId), client.client_id, redirectUri, req.query.state, resource, requested.join(' '), req.query.code_challenge, isoTime(TRANSACTION_TTL_SECONDS)],
      );
      setNoStore(res);
      return res.redirect(303, `/mcp/oauth/authorize?tx=${encodeURIComponent(transactionId)}`);
    } catch (error) { return responseError(res, error); }
  });

  router.post('/mcp/oauth/token', express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }), async (req, res) => {
    const { grant_type: grantType, client_id: clientId } = req.body || {};
    try {
      setNoStore(res);
      if (typeof clientId !== 'string' || !await getClient(db, clientId)) throw oauthError(400, 'invalid_client', 'The OAuth client is not registered.');
      if (grantType === 'authorization_code') {
        const { code, redirect_uri: redirectUri, code_verifier: verifier } = req.body;
        if (typeof code !== 'string' || typeof redirectUri !== 'string' || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw oauthError(400, 'invalid_grant', 'The authorization code or PKCE verifier is invalid.');
        const challenge = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const [rows] = await conn.query(
            `SELECT a.*,c.source_table,c.source_id,c.identity_id,c.tenant_id,c.legacy_uid_hash,c.revoked_at AS connection_revoked
             FROM mcp_oauth_authorization_codes a JOIN mcp_oauth_connections c ON c.id=a.connection_id
             WHERE a.code_hash=? LIMIT 1 FOR UPDATE`, [sha(code)],
          );
          const row = rows[0];
          if (!row || row.client_id !== clientId || row.redirect_uri !== redirectUri || row.consumed_at || row.connection_revoked || new Date(row.expires_at).getTime() <= Date.now() || !safeEqual(row.code_challenge, challenge)) throw oauthError(400, 'invalid_grant', 'The authorization code is expired, already used, or does not match this client.');
          if (req.body.resource && req.body.resource !== row.resource_uri) throw oauthError(400, 'invalid_target', 'The requested resource does not match this authorization.');
          const scopes = splitScopes(row.scope_text);
          const currentActor = await identity.actorForConnection(row);
          const allowed = await identity.allowedScopes(currentActor);
          if (scopes.some(scope => scope !== 'offline_access' && !allowed.has(scope))) throw oauthError(400, 'invalid_grant', 'The account no longer has the requested permission.');
          await conn.query('UPDATE mcp_oauth_authorization_codes SET consumed_at=UTC_TIMESTAMP(3) WHERE code_hash=? AND consumed_at IS NULL', [row.code_hash]);
          const familyId = crypto.randomUUID();
          const tokens = await issueTokenRows(conn, row.connection_id, familyId, row.scope_text, row.resource_uri, scopes.includes('offline_access'));
          await conn.query('UPDATE mcp_oauth_connections SET last_used_at=UTC_TIMESTAMP(3) WHERE id=?', [row.connection_id]);
          await audit(conn, { connectionId: row.connection_id, clientId, eventType: 'token_issued', outcome: 'success' });
          await conn.commit();
          return res.json(tokens);
        } catch (error) { await conn.rollback(); throw error; }
        finally { conn.release(); }
      }

      if (grantType === 'refresh_token') {
        const refreshToken = req.body.refresh_token;
        if (typeof refreshToken !== 'string' || refreshToken.length > 256) throw oauthError(400, 'invalid_grant', 'The refresh token is invalid.');
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const [rows] = await conn.query(
            `SELECT t.*,c.client_id,c.source_table,c.source_id,c.identity_id,c.tenant_id,c.legacy_uid_hash,c.revoked_at AS connection_revoked
             FROM mcp_oauth_tokens t JOIN mcp_oauth_connections c ON c.id=t.connection_id
             WHERE t.token_hash=? AND t.token_type='refresh' LIMIT 1 FOR UPDATE`, [sha(refreshToken)],
          );
          const row = rows[0];
          if (!row || row.client_id !== clientId || row.connection_revoked || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) throw oauthError(400, 'invalid_grant', 'The refresh token is expired or revoked.');
          if (row.consumed_at) {
            await conn.query('UPDATE mcp_oauth_tokens SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE token_family_id=?', [row.token_family_id]);
            await conn.query('UPDATE mcp_oauth_connections SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE id=?', [row.connection_id]);
            await audit(conn, { connectionId: row.connection_id, clientId, eventType: 'refresh_replay_detected', outcome: 'denied' });
            await conn.commit();
            throw oauthError(400, 'invalid_grant', 'Refresh token reuse revoked this connection. Reconnect the account.');
          }
          if (req.body.resource && req.body.resource !== row.resource_uri) throw oauthError(400, 'invalid_target', 'The requested resource does not match this authorization.');
          const currentActor = await identity.actorForConnection(row);
          const allowed = await identity.allowedScopes(currentActor);
          const scopes = splitScopes(row.scope_text);
          if (scopes.some(scope => scope !== 'offline_access' && !allowed.has(scope))) {
            await conn.query('UPDATE mcp_oauth_connections SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [row.connection_id]);
            await conn.query('UPDATE mcp_oauth_tokens SET revoked_at=UTC_TIMESTAMP(3) WHERE connection_id=? AND revoked_at IS NULL', [row.connection_id]);
            await audit(conn, { connectionId: row.connection_id, clientId, eventType: 'permission_change_revoked', outcome: 'denied' });
            await conn.commit();
            throw oauthError(400, 'invalid_grant', 'The account no longer has the permissions granted to this connection.');
          }
          await conn.query('UPDATE mcp_oauth_tokens SET consumed_at=UTC_TIMESTAMP(3) WHERE token_hash=? AND consumed_at IS NULL', [row.token_hash]);
          const tokens = await issueTokenRows(conn, row.connection_id, row.token_family_id, row.scope_text, row.resource_uri, true);
          await conn.query('UPDATE mcp_oauth_connections SET last_used_at=UTC_TIMESTAMP(3) WHERE id=?', [row.connection_id]);
          await audit(conn, { connectionId: row.connection_id, clientId, eventType: 'refresh_rotated', outcome: 'success' });
          await conn.commit();
          return res.json(tokens);
        } catch (error) {
          try { await conn.rollback(); } catch (_) {}
          throw error;
        } finally { conn.release(); }
      }
      throw oauthError(400, 'unsupported_grant_type', 'Only authorization_code and refresh_token grants are supported.');
    } catch (error) { return responseError(res, error); }
  });

  router.post('/mcp/oauth/revoke', express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 10 }), async (req, res) => {
    setNoStore(res);
    try {
      const rawToken = req.body?.token;
      if (typeof rawToken === 'string' && rawToken.length <= 256) {
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const [rows] = await conn.query(
            `SELECT t.token_family_id,t.connection_id,c.client_id
             FROM mcp_oauth_tokens t JOIN mcp_oauth_connections c ON c.id=t.connection_id
             WHERE t.token_hash=? LIMIT 1 FOR UPDATE`, [sha(rawToken)],
          );
          const row = rows[0];
          if (row && (!req.body.client_id || row.client_id === req.body.client_id)) {
            await conn.query('UPDATE mcp_oauth_tokens SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE token_family_id=?', [row.token_family_id]);
            await conn.query('UPDATE mcp_oauth_connections SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE id=?', [row.connection_id]);
            await audit(conn, { connectionId: row.connection_id, clientId: row.client_id, eventType: 'token_revoked', outcome: 'success' });
          }
          await conn.commit();
        } catch (error) { await conn.rollback(); throw error; }
        finally { conn.release(); }
      }
      return res.status(200).end();
    } catch (_) { return res.status(200).end(); }
  });

  router.use((error, _req, res, _next) => responseError(res, error));
  return { router, origin, resource };
}

async function authenticateAccess(db, rawToken, expectedResource) {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 256) return null;
  const [rows] = await db.query(
    `SELECT t.token_hash,t.scope_text,t.resource_uri,t.expires_at,t.revoked_at,
       c.id AS connection_id,c.client_id,c.source_table,c.source_id,c.identity_id,c.tenant_id,c.legacy_uid_hash,c.revoked_at AS connection_revoked
     FROM mcp_oauth_tokens t JOIN mcp_oauth_connections c ON c.id=t.connection_id
     WHERE t.token_hash=? AND t.token_type='access' LIMIT 1`, [sha(rawToken)],
  );
  const row = rows[0];
  if (!row || row.revoked_at || row.connection_revoked || new Date(row.expires_at).getTime() <= Date.now() || row.resource_uri !== expectedResource) return null;
  const actor = await identity.actorForConnection(row);
  const allowed = await identity.allowedScopes(actor);
  const scopes = splitScopes(row.scope_text);
  if (scopes.some(scope => scope !== 'offline_access' && !allowed.has(scope))) throw identity.denied('BUSINESS_ACCESS_CHANGED');
  await db.query('UPDATE mcp_oauth_connections SET last_used_at=IF(last_used_at IS NULL OR last_used_at<UTC_TIMESTAMP(3)-INTERVAL 1 MINUTE,UTC_TIMESTAMP(3),last_used_at) WHERE id=?', [row.connection_id]);
  return { connectionId: row.connection_id, clientId: row.client_id, actor, scopes: new Set(scopes), resource: row.resource_uri };
}

module.exports = {
  BUSINESS_SCOPES, ALL_SCOPES, createOAuthRouter, authenticateAccess,
  publicOrigin, resourceUri, splitScopes, sha, randomToken, audit,
  isChatGptRedirect, createConnectionForSession, issueTokenRows, authorizeRedirect,
  CODE_TTL_SECONDS, TRANSACTION_TTL_SECONDS, oauthError, setNoStore, createClientRegistrationLimiter,
};
