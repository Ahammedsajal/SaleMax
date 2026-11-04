'use strict';

function createAgentLoginService({ query, bcrypt, sign, issueForVerifiedLegacyAccount, assertLegacyHost, jwtKey, now = () => new Date() }) {
  if (![query, bcrypt?.compare, sign, issueForVerifiedLegacyAccount, assertLegacyHost, jwtKey].every(Boolean)) {
    throw new TypeError('Agent login dependencies are required');
  }

  return async function authenticateAgentLogin({ req, email, password }) {
    if (!email || !password) return { success: false, msg: 'Please provide email and password' };

    const agents = await query('SELECT * FROM agents WHERE email = ?', [email]);
    const agent = agents[0];
    if (!agent || !(await bcrypt.compare(password, agent.password))) {
      return { success: false, msg: 'Invalid credentials' };
    }

    if (Number(agent.is_active) !== 1) {
      return { success: false, status: 403, code: 'AGENT_INACTIVE', msg: 'This agent account is inactive.' };
    }

    try {
      await assertLegacyHost(req, agent);
    } catch (error) {
      return {
        success: false,
        status: error.status || 403,
        code: error.code || 'CRM_DOMAIN_TENANT_MISMATCH',
        msg: 'This account cannot sign in from this domain.',
      };
    }

    const businessSession = await issueForVerifiedLegacyAccount({
      kind: 'agent',
      legacyId: Number(agent.id),
      legacyUid: agent.uid,
      legacyEmail: agent.email,
      password,
      address: req.socket.remoteAddress,
      origin: req.get('Origin'),
      tenantHost: req.crmTenantDomain?.hostname,
    });

    const token = sign({
      uid: agent.uid,
      role: 'agent',
      password: agent.password,
      email: agent.email,
      owner_uid: agent.owner_uid,
    }, jwtKey());

    const date = now().toISOString().split('T')[0];
    const loginTime = now().toISOString();
    const logs = agent.logs ? JSON.parse(agent.logs) : {};
    if (!logs.dateTracking) logs.dateTracking = {};
    if (!logs.dateTracking[date]) {
      logs.dateTracking[date] = { logins: 0, logouts: 0, lastLogin: loginTime, lastLogout: null };
    }
    logs.dateTracking[date].logins++;
    logs.dateTracking[date].lastLogin = loginTime;
    await query('UPDATE agents SET logs = ? WHERE uid = ?', [JSON.stringify(logs), agent.uid]);

    return { success: true, token, businessSession, todayStats: logs.dateTracking[date] };
  };
}

function createDefaultAgentLoginService() {
  const { query } = require('../../database/dbpromise.js');
  const bcrypt = require('bcrypt');
  const { sign } = require('jsonwebtoken');
  const { issueForVerifiedLegacyAccount } = require('./legacy-session-bridge');
  const { assertLegacyHost } = require('./tenant-crm-domains');
  return createAgentLoginService({
    query,
    bcrypt,
    sign,
    issueForVerifiedLegacyAccount,
    assertLegacyHost: (req, agent) => assertLegacyHost(query, req, 'agents', agent.id),
    jwtKey: () => process.env.JWTKEY,
  });
}

let defaultService;
async function authenticateAgentLogin(input) {
  if (!defaultService) defaultService = createDefaultAgentLoginService();
  return defaultService(input);
}

module.exports = { createAgentLoginService, authenticateAgentLogin };
