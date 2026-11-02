'use strict';

const express = require('express');
const cors = require('cors');
const { promise: getPool } = require('../../../database/config');
const oauth = require('./oauth');
const { createMcpServer } = require('./tools');

function createRouter({ db = getPool(), origin = oauth.publicOrigin() } = {}) {
  const router = express.Router();
  const resource = oauth.resourceUri(origin);
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const protectedResourceRouter = oauth.createOAuthRouter({ db, origin }).router;
  const mcpCors = cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'MCP-Session-Id', 'Last-Event-ID'],
    exposedHeaders: ['WWW-Authenticate', 'MCP-Session-Id'],
    maxAge: 600,
  });
  router.use(mcpCors);
  router.use(protectedResourceRouter);

  function challenge(res, error = 'invalid_token') {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}", error="${error}"`);
    res.setHeader('Cache-Control', 'no-store');
  }

  router.post('/mcp', express.json({ limit: '32kb', strict: true }), async (req, res) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '')?.[1];
    if (!bearer) {
      challenge(res, 'invalid_token');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let auth;
    try { auth = await oauth.authenticateAccess(db, bearer, resource); }
    catch (error) {
      if (error?.code === 'BUSINESS_ACCESS_CHANGED' || error?.code === 'ACCOUNT_NOT_AVAILABLE' || error?.code === 'BUSINESS_ACCESS_INACTIVE') {
        challenge(res, 'invalid_token');
        return res.status(401).json({ error: 'Account authorization is no longer active.' });
      }
      if (Number(error?.status) === 403) {
        challenge(res, 'insufficient_scope');
        return res.status(403).json({ error: 'The connected account no longer has this permission.' });
      }
      console.error('7Network MCP authentication failed:', error?.code || error?.name || 'unknown');
      return res.status(503).json({ error: 'MCP service unavailable' });
    }
    if (!auth) {
      challenge(res, 'invalid_token');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const server = createMcpServer(auth);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: 32 * 1024,
        enableDnsRebindingProtection: true,
        allowedHosts: [new URL(origin).host],
      });
      req.auth = { token: bearer, clientId: auth.clientId, scopes: [...auth.scopes], resource, extra: { connectionId: auth.connectionId } };
      await server.connect(transport);
      res.on('close', () => { void server.close().catch(() => {}); });
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('7Network MCP transport failed:', error?.code || error?.name || 'unknown');
      if (!res.headersSent) res.status(400).json({ error: 'Invalid MCP request' });
    }
  });

  router.get('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Use POST for MCP Streamable HTTP requests.' });
  });
  router.delete('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'This stateless MCP server does not use DELETE sessions.' });
  });

  return router;
}

module.exports = { createRouter };
