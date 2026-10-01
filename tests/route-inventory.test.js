const test = require('node:test');
const assert = require('node:assert/strict');
const { inventory } = require('../scripts/inventory-routes.cjs');
test('inventory records actual mounted declarations and ignores commented login', () => {
  const result = inventory();
  assert.ok(result.mounts.some(m => m.prefix === '/api/pipeline'));
  const agentLogin = result.routes.filter(r => r.path === '/api/agent/login' && r.method === 'POST');
  assert.equal(agentLogin.length, 1);
  const exchange = result.routes.find(r => r.path === '/api/web/exchange-token');
  assert.deepEqual(exchange.declaredGuards, ['require(../middlewares/user.js)']);
  assert.ok(result.routes.find(r => r.path === '/api/agent/add_agent').declaredGuards.includes('checkPlan'));
});
