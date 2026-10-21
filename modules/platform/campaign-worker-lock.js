'use strict';

const crypto = require('node:crypto');

function campaignLockName(uid, campaignId) {
  if (typeof uid !== 'string' || !uid || typeof campaignId !== 'string' || !campaignId) {
    const error = new TypeError('CAMPAIGN_OWNER_REQUIRED');
    error.code = 'CAMPAIGN_OWNER_REQUIRED';
    throw error;
  }
  const digest = crypto.createHash('sha256')
    .update(`${uid}\0${campaignId}`)
    .digest('hex')
    .slice(0, 46);
  // Lowercase hex avoids the case-insensitive lock-name comparison and fits
  // MariaDB/MySQL's 64-character named-lock limit with the app prefix.
  return `7network:campaign:${digest}`;
}

async function acquireCampaignWorkerLock(pool, uid, campaignId) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw new TypeError('CAMPAIGN_LOCK_POOL_REQUIRED');
  }

  const name = campaignLockName(uid, campaignId);
  const connection = await pool.getConnection();
  let acquired = false;
  let connectionId;

  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [name]);
    if (Number(lock?.acquired) !== 1) {
      connection.release();
      return null;
    }
    acquired = true;

    const [[session]] = await connection.query('SELECT CONNECTION_ID() AS connectionId');
    connectionId = Number(session?.connectionId);
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) {
      const error = new Error('CAMPAIGN_LOCK_SESSION_UNAVAILABLE');
      error.code = 'CAMPAIGN_LOCK_SESSION_UNAVAILABLE';
      throw error;
    }
  } catch (error) {
    if (acquired) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?) AS released', [name]);
      } catch (_) {
        if (typeof connection.destroy === 'function') connection.destroy();
        else connection.release();
        throw error;
      }
    }
    connection.release();
    throw error;
  }

  let released = false;
  return {
    name,
    async assertHeld() {
      if (released) {
        const error = new Error('CAMPAIGN_LOCK_LOST');
        error.code = 'CAMPAIGN_LOCK_LOST';
        throw error;
      }
      const [[owner]] = await connection.query('SELECT IS_USED_LOCK(?) AS ownerConnectionId', [name]);
      if (Number(owner?.ownerConnectionId) !== connectionId) {
        const error = new Error('CAMPAIGN_LOCK_LOST');
        error.code = 'CAMPAIGN_LOCK_LOST';
        throw error;
      }
    },
    async release() {
      if (released) return;
      released = true;
      let reusable = true;
      try {
        await connection.query('SELECT RELEASE_LOCK(?) AS released', [name]);
      } catch (error) {
        reusable = false;
        if (typeof connection.destroy === 'function') connection.destroy();
        else connection.release();
        console.error('Campaign worker lock connection was discarded after release failed.', error.code || 'DB_ERROR');
      } finally {
        if (reusable) connection.release();
      }
    },
  };
}

module.exports = { campaignLockName, acquireCampaignWorkerLock };
