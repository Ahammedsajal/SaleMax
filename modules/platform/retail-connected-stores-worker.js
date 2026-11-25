'use strict';

const plans = require('./plans');
const localSnapshots = require('./retail-native-import-backfill');
const intervalMs = 15 * 60 * 1000;
const connectorRouter = () => require('./retail-connected-stores-router');
let connectionCursor = { tenantId: '', id: '' };

async function loadConnectionPage(pool, limit, cursor = connectionCursor) {
  let [connections] = await pool.query(`SELECT * FROM sx_retail_store_connections
    WHERE status='active' AND (tenant_id>? OR (tenant_id=? AND id>?))
    ORDER BY tenant_id,id LIMIT ?`, [cursor.tenantId, cursor.tenantId, cursor.id, limit]);
  if (!connections.length && (cursor.tenantId || cursor.id)) {
    connectionCursor = { tenantId: '', id: '' };
    [connections] = await pool.query(`SELECT * FROM sx_retail_store_connections WHERE status='active'
      ORDER BY tenant_id,id LIMIT ?`, [limit]);
  }
  if (connections.length) connectionCursor = { tenantId: connections.at(-1).tenant_id, id: connections.at(-1).id };
  return connections;
}

async function backfill(pool, { logger = console, limit = 25, maxRounds = 20, plansModule = plans,
  backfillConnection = localSnapshots.backfillConnection } = {}) {
  return localSnapshots.backfillActiveConnections(pool, { logger, limit, maxRounds, plansModule, backfill: backfillConnection });
}

async function run(pool, { logger = console, limit = 25, plansModule = plans,
  backfillConnection = localSnapshots.backfillConnection, syncShopify, syncWoo } = {}) {
  const connections = await loadConnectionPage(pool, limit);
  const entitlements = new Map(), results = [];
  for (const connection of connections) {
    try {
      let entitlement = entitlements.get(connection.tenant_id);
      if (!entitlements.has(connection.tenant_id)) {
        entitlement = await plansModule.loadEntitlements(pool, connection.tenant_id);
        entitlements.set(connection.tenant_id, entitlement || null);
      }
      if (!entitlement || !['active','trial','grace'].includes(entitlement.status) || !entitlement.capabilities?.includes('retail.commerce')) {
        results.push({ connectionId: connection.id, status: 'skipped', reason: 'FEATURE_UNAVAILABLE' });
        continue;
      }
      const local = await backfillConnection(pool, connection, { limit });
      if (local.failed) logger.error('Retail local snapshot backfill needs review.', {
        connectionId: connection.id, failures: local.failed, codes: (local.failures || []).map(item => item.code),
      });
      if (!connection.credentials_verified_at) {
        results.push({ connectionId: connection.id, provider: connection.provider, status: 'credentials_required', backfill: local });
        continue;
      }
      const integrations = syncShopify && syncWoo ? null : connectorRouter();
      const result = connection.provider === 'shopify'
        ? await (syncShopify || integrations.syncShopify)(pool, connection)
        : await (syncWoo || integrations.syncWoo)(pool, connection);
      results.push({ connectionId: connection.id, provider: connection.provider, status: 'synced', backfill: local, result });
    } catch (error) {
      const code = /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? error.code : 'RETAIL_CONNECTOR_FAILED';
      await pool.query(`UPDATE sx_retail_store_connections SET last_error_code=?
        WHERE tenant_id=? AND id=? AND status='active'`, [code, connection.tenant_id, connection.id]).catch(() => {});
      logger.error('Retail store reconciliation failed.', { connectionId: connection.id, provider: connection.provider, code });
      results.push({ connectionId: connection.id, provider: connection.provider, status: 'failed', code });
    }
  }
  return { checked: connections.length, results };
}

function start(pool, { logger = console, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
  interval = intervalMs, disabled = process.env.LOCAL_ONLY_MODE === 'true' } = {}) {
  if (!pool || disabled) return () => {};
  let busy = false;
  const timer = setIntervalImpl(() => {
    if (busy) return;
    busy = true;
    run(pool, { logger }).catch(() => logger.error('Retail store reconciliation worker tick failed.')).finally(() => { busy = false; });
  }, interval);
  timer.unref?.();
  return () => clearIntervalImpl(timer);
}

module.exports = { run, backfill, start, intervalMs };
