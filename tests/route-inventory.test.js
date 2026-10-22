const test = require('node:test');
const assert = require('node:assert/strict');
const { inventory } = require('../scripts/inventory-routes.cjs');
test('inventory records actual mounted declarations and ignores commented login', () => {
  const result = inventory();
  const prefixes = new Set(result.mounts.map(m => m.prefix));
  for (const prefix of [
    '/api/pipeline', '/api/workspace/pipeline',
    '/api/chat_flow', '/api/workspace/automation/flows',
    '/api/inbox', '/api/workspace/inbox',
    '/api/templet', '/api/workspace/templates',
    '/api/chatbot', '/api/workspace/automation/chatbot',
    '/api/broadcast', '/api/workspace/campaigns',
    '/api/qr', '/api/workspace/channels/qr',
  ]) assert.ok(prefixes.has(prefix), `mounted route family ${prefix} is inventoried`);
  assert.ok(result.routes.some(r => r.path === '/api/pipeline/board'));
  assert.ok(result.routes.some(r => r.path === '/api/workspace/pipeline/board'));
  const agentLogin = result.routes.filter(r => r.path === '/api/agent/login' && r.method === 'POST');
  assert.equal(agentLogin.length, 1);
  const exchange = result.routes.find(r => r.path === '/api/web/exchange-token');
  assert.deepEqual(exchange.declaredGuards, ['require(../middlewares/user.js)']);
  assert.ok(result.routes.find(r => r.path === '/api/agent/add_agent').declaredGuards.includes('checkPlan'));
});

test('private web settings require the existing administrator guard', () => {
  const route = inventory().routes.find(r => r.path === '/api/web/get_web_pvt' && r.method === 'GET');
  assert.ok(route, 'private web settings route is present');
  assert.deepEqual(route.declaredGuards, ['adminValidator']);
});
