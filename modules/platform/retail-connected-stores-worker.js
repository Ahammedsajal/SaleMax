'use strict';

const router = require('./retail-connected-stores-router');
const plans = require('./plans');
const intervalMs = 15 * 60 * 1000;

async function run(pool, { logger = console, limit = 25 } = {}) {
  const [connections] = await pool.query(`SELECT * FROM sx_retail_store_connections
    WHERE status='active' AND credentials_verified_at IS NOT NULL
    ORDER BY COALESCE(last_sync_at,'1970-01-01 00:00:00'),created_at,id LIMIT ?`, [limit]);
  const entitlements = new Map(), results = [];
  for (const connection of connections) {
    try {
      let entitlement = entitlements.get(connection.tenant_id);
      if (!entitlements.has(connection.tenant_id)) {
        entitlement = await plans.loadEntitlements(pool, connection.tenant_id);
        entitlements.set(connection.tenant_id, entitlement || null);
      }
      if (!entitlement || !['active','trial','grace'].includes(entitlement.status) || !entitlement.capabilities?.includes('retail.commerce')) {
        results.push({ connectionId: connection.id, status: 'skipped', reason: 'FEATURE_UNAVAILABLE' });
        continue;
      }
      const result = connection.provider === 'shopify' ? await router.syncShopify(pool, connection) : await router.syncWoo(pool, connection);
      results.push({ connectionId: connection.id, provider: connection.provider, status: 'synced', result });
    } catch (error) {
      const code = /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? error.code : 'RETAIL_CONNECTOR_FAILED';
      await pool.query(`UPDATE sx_retail_store_connections SET last_sync_at=UTC_TIMESTAMP(3),last_error_code=?
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

module.exports = { run, start, intervalMs };
