'use strict';

/**
 * Preserve business-user priority when its password matches, but let a shared
 * login resolve an agent with the same email when only the agent password
 * matches. Explicit user mode never falls through to agent authentication.
 */
function shouldTryAgentLogin({ actor = 'auto', businessUserAuthenticated = false } = {}) {
  return actor !== 'user' && !businessUserAuthenticated;
}

module.exports = { shouldTryAgentLogin };
