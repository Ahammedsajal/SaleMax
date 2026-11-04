'use strict';

const businessSessions = require('./business-feature-session');

async function tenantIdForOwnerUid(pool, ownerUid, resolveSession = businessSessions.resolve) {
  if (typeof ownerUid !== 'string' || !ownerUid.trim()) return null;
  const [[actor]] = await pool.query('SELECT id,uid FROM user WHERE uid=? LIMIT 1', [ownerUid]);
  if (!actor) return null;
  const session = await resolveSession(pool, { actor });
  return session?.context?.tenant?.id || null;
}

module.exports = { tenantIdForOwnerUid };
