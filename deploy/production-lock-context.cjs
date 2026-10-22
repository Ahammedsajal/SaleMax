'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SHARED_LOCK_PATH = '/opt/salemax/shared/7network-production-deploy.lock';

function assertSharedLockContext({
  env = process.env,
  lockPath = SHARED_LOCK_PATH,
  fstat = fs.fstatSync,
  stat = fs.statSync,
  readLocks = () => fs.readFileSync('/proc/locks', 'utf8'),
  fdIdentity = () => {
    const stdio = ['ignore', 'pipe', 'pipe'];
    while (stdio.length <= 9) stdio.push('ignore');
    stdio[9] = 9;
    const result = spawnSync('stat', ['-Lc', '%t:%T:%i', '/proc/self/fd/9'], { encoding: 'utf8', stdio });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Unable to resolve inherited production lock descriptor');
    return result.stdout.trim();
  }
} = {}) {
  if (env.SALEMAX_DEPLOY_LOCK_HELD !== '1') {
    throw new Error('Run this operation inside /opt/salemax/shared/with-production-lock.sh');
  }

  const ownerPid = String(env.SALEMAX_DEPLOY_LOCK_OWNER_PID || '');
  if (!/^[1-9][0-9]*$/.test(ownerPid) || env.SALEMAX_DEPLOY_LOCK_FD !== '9') {
    throw new Error('The lock owner and inherited descriptor are missing from the production wrapper context');
  }

  let inherited;
  let shared;
  try {
    inherited = fstat(9);
    shared = stat(lockPath);
  } catch {
    throw new Error('The shared production lock descriptor 9 is not inherited by this process');
  }
  if (inherited.dev !== shared.dev || inherited.ino !== shared.ino) {
    throw new Error('Descriptor 9 does not reference the shared production lock inode');
  }

  let identity;
  let locks;
  try {
    identity = fdIdentity();
    locks = readLocks();
  } catch {
    throw new Error('Unable to verify the active OS-level flock for the inherited production lock');
  }
  const ownerLock = String(locks).split('\n').some(line => {
    const fields = line.trim().split(/\s+/);
    return fields[1] === 'FLOCK' && fields[3] === 'WRITE'
      && fields[4] === ownerPid && fields[5] === identity;
  });
  if (!ownerLock) throw new Error('The shared production flock is not held by this wrapper invocation');
  return true;
}

module.exports = { SHARED_LOCK_PATH, assertSharedLockContext };
