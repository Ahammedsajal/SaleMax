'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

function start({ env = process.env, spawnProcess = spawn, executable = process.execPath,
  root = path.resolve(__dirname, '..', '..') } = {}) {
  if (env.LOCAL_ONLY_MODE === 'true' || env.SALEMAX_ARI_EVENTS_ENABLED !== 'true') return null;
  return spawnProcess(executable, [path.join(root, 'scripts', 'asterisk-ari-events-worker.cjs')], {
    env, stdio: 'inherit', windowsHide: true,
  });
}

module.exports = { start };
