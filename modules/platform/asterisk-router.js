'use strict';

const crypto = require('node:crypto');
const express = require('express');
const asterisk = require('./asterisk-config');
const gatewayPorts = require('./asterisk-gateway-ports');
const tenantGateways = require('./tenant-asterisk-gateways');

function createAsteriskRouter({ pool }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const withDb = async fn => { const db = await pool.getConnection(); try { return await fn(db); } finally { db.release(); } };
  router.use(express.json({ limit: '12kb', strict: true }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      return res.status(400).json({ success: false, code: 'INVALID_BODY' });
    }
    next();
  });
  router.use(wrap(async (req, res, next) => {
    const context = req.businessContext;
    if (context?.audience !== 'platform' || !req.legacyAdminId || typeof req.decode?.uid !== 'string') {
      throw Object.assign(new Error('PLATFORM_REQUIRED'), { code: 'PLATFORM_REQUIRED' });
    }
    const uidHash = crypto.createHash('sha256').update(req.decode.uid, 'utf8').digest('hex');
    const [links] = await withDb(db => db.query(`SELECT legacy_uid,identity_id,status FROM sx_legacy_admin_identities
      WHERE legacy_admin_id=? AND legacy_uid_hash=?`, [req.legacyAdminId, uidHash]));
    if (links.length !== 1 || links[0].legacy_uid !== req.decode.uid || links[0].identity_id !== context.identity.id || links[0].status !== 'active') {
      throw Object.assign(new Error('VERIFIED_ADMIN_LINK_REQUIRED'), { code: 'VERIFIED_ADMIN_LINK_REQUIRED' });
    }
    next();
  }));
  router.get('/config', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => asterisk.get(db, req.businessContext)) })));
  router.get('/gateway-config-preview', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => asterisk.previewGateway(db, req.businessContext)) })));
  router.get('/host-setup-preview', wrap(async (req, res) => res.json({ success: true, data: asterisk.previewHostSetup(req.businessContext) })));
  router.post('/apply-gateway-peer', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => asterisk.applyGatewayPeer(db, req.businessContext)) })));
  router.get('/agent-endpoint-preview', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => asterisk.previewAgentEndpoints(db, req.businessContext)) })));
  router.get('/gateway-routing-preview', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => gatewayPorts.previewRouting(db, req.businessContext)) })));
  router.put('/config', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => asterisk.save(db, req.businessContext, req.body)) })));
  router.post('/connection-test', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => asterisk.test(db, req.businessContext)) })));
  router.get('/gateway-ports', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => gatewayPorts.list(db, req.businessContext)) })));
  router.get('/gateway-tenants', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => gatewayPorts.listTenants(db, req.businessContext)) })));
  router.get('/gateway-queues', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => gatewayPorts.listQueues(db, req.businessContext, req.query.tenantId)) })));
  router.put('/gateway-ports', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => gatewayPorts.save(db, req.businessContext, req.body)) })));
  router.get('/business/:userId/gateway', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => tenantGateways.read(db, req.businessContext, req.params.userId)) })));
  router.get('/business/:userId/queues', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => tenantGateways.queues(db, req.businessContext, req.params.userId)) })));
  router.put('/business/:userId/gateway', wrap(async (req, res) => res.json({ success: true, data: await withDb(db => tenantGateways.save(db, req.businessContext, req.params.userId, req.body)) })));
  router.get('/business-gateway-statuses', wrap(async (req, res) => {
    const userIds=String(req.query.userIds||'').split(',').filter(Boolean);
    res.json({success:true,data:await withDb(db=>tenantGateways.statuses(db,req.businessContext,userIds))});
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const code = error.code || '';
    if (!code) console.error('[asterisk-api] unclassified handler error', {
      method: req.method,
      route: req.route?.path || req.path,
      type: error.name || 'Error',
    });
    const status = ['PERMISSION_DENIED', 'PLATFORM_REQUIRED', 'VERIFIED_ADMIN_LINK_REQUIRED','TENANT_PORTFOLIO_FORBIDDEN'].includes(code) ? 403
      : ['STALE_REVISION', 'STALE_GATEWAY_REVISION','STALE_GATEWAY_CHANNEL_REVISION', 'GATEWAY_CHANNEL_MUST_BE_DISABLED_FOR_REASSIGNMENT', 'GATEWAY_DID_ALREADY_ASSIGNED', 'ASTERISK_CONFIG_CHANGED_DURING_TEST'].includes(code) ? 409
            : ['TENANT_NOT_FOUND','GATEWAY_QUEUE_TENANT_MISMATCH'].includes(code) ? 404
            : ['TENANT_TELEPHONY_UNAVAILABLE'].includes(code) ? 409
            : ['GATEWAY_QUEUE_DISABLED','TELEPHONY_QUEUE_INBOUND_CHANNELS_ACTIVE'].includes(code) ? 409
            : ['ARI_CREDENTIAL_REQUIRED', 'GATEWAY_IP_REQUIRED', 'GATEWAY_TENANT_REQUIRED', 'GATEWAY_DID_REQUIRED','GATEWAY_QUEUE_REQUIRED','GATEWAY_DID_AND_QUEUE_REQUIRED','INVALID_BUSINESS_USER','INVALID_GATEWAY_CONFIG','INVALID_GATEWAY_TENANT','INVALID_GATEWAY_QUEUE', 'INVALID_GATEWAY_DID', 'INVALID_GATEWAY_IP','INVALID_GATEWAY_PORT', 'INSECURE_GATEWAY_TRANSPORT'].includes(code) || code.startsWith('INVALID_GATEWAY_CHANNEL') ? 400
      : code.startsWith('INVALID_') ? 400
          : code === 'ARI_AUTH_REJECTED' ? 502
            : ['ARI_TIMEOUT', 'ARI_UNAVAILABLE', 'ARI_UNREACHABLE', 'ARI_INVALID_RESPONSE', 'ASTERISK_CONFIG_UNAVAILABLE', 'ASTERISK_HOST_ALLOWLIST_REQUIRED', 'ASTERISK_HOST_NOT_ALLOWED', 'ASTERISK_SECRET_KEY_UNAVAILABLE'].includes(code) ? 503
              : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 503;
    res.status(status).json({ success: false, code: status === 503 && !code ? 'ASTERISK_SETUP_UNAVAILABLE' : code || 'ASTERISK_SETUP_UNAVAILABLE' });
  });
  return router;
}

module.exports = { createAsteriskRouter };
