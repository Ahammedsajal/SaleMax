'use strict';

const express = require('express');
const identity = require('./identity');
const oauth = require('./oauth');

function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
const json = (res, data, status = 200) => res.status(status).json({ success: true, data });

function createWorkspaceRouter({ db, sessionGuard, origin }) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb', strict: true }));
  router.use(sessionGuard);

  const requireCurrentActor = async req => identity.actorFromFeatureSession(req.featureSession);
  const handle = work => async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Referrer-Policy', 'same-origin');
      return await work(req, res);
    } catch (error) {
      const status = Number(error?.status) || 503;
      if (status >= 500) console.error('7Network ChatGPT workspace request failed:', error?.code || error?.name || 'unknown');
      return res.status(status).json({ success: false, code: status >= 500 ? 'CHATGPT_WORKSPACE_UNAVAILABLE' : error.code || 'REQUEST_FAILED' });
    }
  };

  router.get('/connections', handle(async (req, res) => {
    const actor = await requireCurrentActor(req);
    const [rows] = await db.query(
      `SELECT c.id,c.client_id,cl.client_name,c.actor_role,c.scope_text,c.created_at,c.last_used_at,c.revoked_at
       FROM mcp_oauth_connections c JOIN mcp_oauth_clients cl ON cl.client_id=c.client_id
       WHERE c.source_table=? AND c.source_id=? AND c.legacy_uid_hash=? AND c.tenant_id <=> ?
       ORDER BY c.created_at DESC LIMIT 50`,
      [actor.sourceTable, actor.sourceId, actor.uidHash, actor.tenantId],
    );
    const scopes = await identity.allowedScopes(actor);
    return json(res, {
      endpoint: `${origin}/mcp`,
      oauthEnabled: true,
      eligible: scopes.has('pipeline.read'),
      permissions: [...scopes],
      connections: rows.map(row => ({
        id: row.id,
        name: row.client_name,
        role: row.actor_role,
        scopes: oauth.splitScopes(row.scope_text),
        connectedAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
        status: row.revoked_at ? 'revoked' : 'connected',
      })),
    });
  }));

  router.get('/oauth-transaction', handle(async (req, res) => {
    const transactionId = req.query.transaction_id;
    if (typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(transactionId)) return fail('OAUTH_TRANSACTION_INVALID');
    const actor = await requireCurrentActor(req);
    const [rows] = await db.query(
      `SELECT t.client_id,t.redirect_uri,t.scope_text,t.expires_at,t.consumed_at,cl.client_name
       FROM mcp_oauth_authorization_transactions t JOIN mcp_oauth_clients cl ON cl.client_id=t.client_id
       WHERE t.transaction_hash=? LIMIT 1`, [oauth.sha(transactionId)],
    );
    const transaction = rows[0];
    if (!transaction || transaction.consumed_at || new Date(transaction.expires_at).getTime() <= Date.now()) return fail('OAUTH_TRANSACTION_EXPIRED', 410);
    const requested = oauth.splitScopes(transaction.scope_text);
    const allowed = await identity.allowedScopes(actor);
    const available = requested.filter(scope => scope === 'offline_access' || allowed.has(scope));
    return json(res, {
      clientName: transaction.client_name,
      requestedScopes: requested,
      availableScopes: available,
      suggestedScopes: available.filter(scope => scope !== 'tasks.manage'),
      account: { name: actor.rawActor.name || actor.rawActor.email, email: actor.rawActor.email, role: actor.role },
    });
  }));

  router.post('/oauth-authorize', handle(async (req, res) => {
    const transactionId = req.body?.transaction_id;
    const requested = req.body?.scopes;
    if (typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(transactionId) || !Array.isArray(requested) || requested.length > oauth.ALL_SCOPES.length) return fail('OAUTH_REQUEST_INVALID');
    const actor = await requireCurrentActor(req);
    const allowed = await identity.allowedScopes(actor);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT t.*,cl.client_name FROM mcp_oauth_authorization_transactions t
         JOIN mcp_oauth_clients cl ON cl.client_id=t.client_id
         WHERE t.transaction_hash=? LIMIT 1 FOR UPDATE`, [oauth.sha(transactionId)],
      );
      const transaction = rows[0];
      if (!transaction || transaction.consumed_at || new Date(transaction.expires_at).getTime() <= Date.now()) return fail('OAUTH_TRANSACTION_EXPIRED', 410);
      const requestedScopes = oauth.splitScopes(transaction.scope_text);
      const granted = [...new Set(requested)];
      if (!granted.length || granted.some(scope => !requestedScopes.includes(scope) || (scope !== 'offline_access' && !allowed.has(scope)))) return fail('OAUTH_SCOPE_NOT_AVAILABLE', 403);
      const connectionId = await oauth.createConnectionForSession(conn, actor, transaction.client_id, granted);
      const code = oauth.randomToken(32);
      await conn.query(
        `INSERT INTO mcp_oauth_authorization_codes
          (code_hash,client_id,connection_id,redirect_uri,resource_uri,scope_text,code_challenge,expires_at)
         VALUES(?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))`,
        [oauth.sha(code), transaction.client_id, connectionId, transaction.redirect_uri, transaction.resource_uri, granted.join(' '), transaction.code_challenge, oauth.CODE_TTL_SECONDS],
      );
      await conn.query('UPDATE mcp_oauth_authorization_transactions SET consumed_at=UTC_TIMESTAMP(3) WHERE transaction_hash=? AND consumed_at IS NULL', [oauth.sha(transactionId)]);
      await oauth.audit(conn, { connectionId, clientId: transaction.client_id, eventType: 'consent_granted', outcome: 'success', details: { scopes: granted } });
      const redirectUrl = oauth.authorizeRedirect({ ...transaction, state_value: transaction.state_value }, code, origin);
      await conn.commit();
      return json(res, { redirectUrl });
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      throw error;
    } finally { conn.release(); }
  }));

  router.delete('/connections/:id', handle(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return fail('CONNECTION_NOT_FOUND', 404);
    const actor = await requireCurrentActor(req);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT id,client_id FROM mcp_oauth_connections
         WHERE id=? AND source_table=? AND source_id=? AND legacy_uid_hash=? AND tenant_id <=> ? LIMIT 1 FOR UPDATE`,
        [req.params.id, actor.sourceTable, actor.sourceId, actor.uidHash, actor.tenantId],
      );
      const connection = rows[0];
      if (!connection) return fail('CONNECTION_NOT_FOUND', 404);
      await conn.query('UPDATE mcp_oauth_connections SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE id=?', [connection.id]);
      await conn.query('UPDATE mcp_oauth_tokens SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE connection_id=?', [connection.id]);
      await oauth.audit(conn, { connectionId: connection.id, clientId: connection.client_id, eventType: 'connection_revoked', outcome: 'success' });
      await conn.commit();
      return json(res, { id: connection.id, status: 'revoked' });
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      throw error;
    } finally { conn.release(); }
  }));

  router.post('/oauth-deny', handle(async (req, res) => {
    const transactionId = req.body?.transaction_id;
    if (typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(transactionId)) return fail('OAUTH_REQUEST_INVALID');
    await requireCurrentActor(req);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT transaction_hash,client_id,redirect_uri,state_value,expires_at,consumed_at FROM mcp_oauth_authorization_transactions WHERE transaction_hash=? LIMIT 1 FOR UPDATE', [oauth.sha(transactionId)]);
      const transaction = rows[0];
      if (!transaction || transaction.consumed_at || new Date(transaction.expires_at).getTime() <= Date.now()) return fail('OAUTH_TRANSACTION_EXPIRED', 410);
      await conn.query('UPDATE mcp_oauth_authorization_transactions SET consumed_at=UTC_TIMESTAMP(3) WHERE transaction_hash=?', [oauth.sha(transactionId)]);
      const callback = new URL(transaction.redirect_uri);
      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('state', transaction.state_value);
      callback.searchParams.set('iss', origin);
      await conn.commit();
      return json(res, { redirectUrl: callback.toString() });
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      throw error;
    } finally { conn.release(); }
  }));

  return router;
}

module.exports = { createWorkspaceRouter };
