'use strict';
const express = require('express');
const settings = require('./tenant-ai-settings');
const { decision } = require('./policy');

function createTenantAiSettingsRouter({ pool, origin, authenticate }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  router.use(express.json({ limit: '8kb', strict: true }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !require('./request-origin').matches(req, origin)) return res.status(403).json({ success: false, code: 'ORIGIN_DENIED' });
    next();
  });
  router.use(authenticate);
  function ownerContext(req) {
    const ctx = req.featureSession?.context;
    const access = decision(ctx, { capability: 'tenant.settings', permission: 'tenant.manage' });
    if (!access.allowed || ctx.membership?.role !== 'owner') throw Object.assign(Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED', status: 403 });
    return ctx;
  }
  router.get('/', wrap(async (req, res) => {
    const ctx = ownerContext(req), db = await pool.getConnection();
    try { res.json({ success: true, data: await settings.read(db, ctx.tenant.id) }); }
    finally { db.release(); }
  }));
  router.put('/', wrap(async (req, res) => {
    const ctx = ownerContext(req), db = await pool.getConnection();
    try { res.json({ success: true, data: await settings.save(db, ctx, req.body) }); }
    finally { db.release(); }
  }));
  router.post('/test', wrap(async (req, res) => {
    const ctx = ownerContext(req), db = await pool.getConnection();
    try { res.json({ success: true, data: await settings.test(db, ctx, req.body) }); }
    finally { db.release(); }
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const code = error.code || 'AI_SETTINGS_UNAVAILABLE';
    const conflicts = ['STALE_REVISION','LIVE_BOT_MUST_BE_PAUSED','PROVIDER_NOT_CONFIGURED','AI_PROVIDER_NOT_CONFIGURED'];
    const clientErrors = ['PROVIDER_KEY_REQUIRED','INVALID_PROVIDER_CONFIG','INVALID_PROVIDER_KEY','INVALID_PROVIDER_REVISION','INVALID_PROVIDER_ACTION','INVALID_DAILY_TOKEN_LIMIT'];
    const status = Number.isInteger(error.status) ? error.status
      : conflicts.includes(code) ? 409
        : clientErrors.includes(code) || code.startsWith('INVALID_') ? 400
          : code === 'PROVIDER_CONNECTION_FAILED' ? 502 : 503;
    const safeCodes = new Set([...conflicts, ...clientErrors, 'PERMISSION_DENIED', 'PROVIDER_CONNECTION_FAILED']);
    res.status(status).json({ success: false, code: safeCodes.has(code) ? code : 'AI_SETTINGS_UNAVAILABLE' });
  });
  return router;
}

module.exports = { createTenantAiSettingsRouter };
