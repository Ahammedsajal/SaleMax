'use strict';

const fs = require('node:fs');

const SHARED_LOCK_PATH = '/opt/salemax/shared/7network-production-deploy.lock';

function assertSharedLockContext({
  env = process.env,
  lockPath = SHARED_LOCK_PATH,
  fstat = fs.fstatSync,
  stat = fs.statSync
} = {}) {
  if (env.SALEMAX_DEPLOY_LOCK_HELD !== '1') {
    throw new Error('Run this operation inside /opt/salemax/shared/with-production-lock.sh');
  }
  if (env.SALEMAX_DEPLOY_LOCK_FD !== '9') {
    throw new Error('The inherited production lock descriptor is missing from the wrapper context');
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

  return true;
}

module.exports = { SHARED_LOCK_PATH, assertSharedLockContext };
