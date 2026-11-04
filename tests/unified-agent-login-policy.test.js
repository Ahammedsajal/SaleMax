'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { shouldTryAgentLogin } = require('../modules/platform/unified-agent-login-policy');
const loginRoute = fs.readFileSync(require.resolve('../routes/user'), 'utf8');

test('the existing /user login route uses the shared agent fallback policy', () => {
  assert.match(loginRoute, /require\(["']\.\.\/modules\/platform\/unified-agent-login-policy["']\)/);
  assert.match(loginRoute, /if\s*\(shouldTryAgentLogin\(\{\s*actor:\s*loginAs,\s*businessUserAuthenticated:\s*compare\s*\}\)\)/);
});

test('shared login checks the agent account if the email matched a business user but its password did not', () => {
  assert.equal(shouldTryAgentLogin({ actor: 'auto', businessUserAuthenticated: false }), true);
});

test('a valid business-user password keeps business-user priority', () => {
  assert.equal(shouldTryAgentLogin({ actor: 'auto', businessUserAuthenticated: true }), false);
});

test('explicit user login never falls through to agent authentication', () => {
  assert.equal(shouldTryAgentLogin({ actor: 'user', businessUserAuthenticated: false }), false);
});

test('explicit agent login skips business-user credentials', () => {
  assert.equal(shouldTryAgentLogin({ actor: 'agent', businessUserAuthenticated: false }), true);
});
