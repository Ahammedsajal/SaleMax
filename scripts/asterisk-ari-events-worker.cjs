'use strict';

require('dotenv').config({ quiet: true });
if (process.env.SALEMAX_ARI_EVENTS_ENABLED !== 'true') throw new Error('ARI_EVENTS_WORKER_DISABLED');

const os = require('node:os');
const pool = require('../database/config').promise();
const { AsteriskAriEvents } = require('../modules/platform/asterisk-ari-events');
const { AsteriskCallControl } = require('../modules/platform/asterisk-call-control');

const workerId = process.env.SALEMAX_ARI_EVENTS_WORKER_ID
  || `asterisk-${os.hostname().replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 70)}-${process.pid}`;
const events = new AsteriskAriEvents({ pool, workerId });
const callControl = new AsteriskCallControl({ pool, log: entry => console.error(JSON.stringify({ ...entry, workerId })) });
callControl.start(events);
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  callControl.stop();
  await events.stop();
  await pool.end();
}

process.once('SIGINT', () => stop().then(() => process.exit(0)));
process.once('SIGTERM', () => stop().then(() => process.exit(0)));

events.on('connected', () => console.log(JSON.stringify({ ariEvents: 'connected', workerId })));
events.on('lockLost', () => {
  console.error(JSON.stringify({ ariEvents: 'worker_lock_lost', workerId }));
  stop().then(() => { process.exitCode = 1; });
});
events.on('ariEvent', event => {
  if (event.type === 'StasisStart') console.log(JSON.stringify({ ariEvent: 'StasisStart', workerId }));
});

events.start().then(acquired => {
  if (!acquired) throw Object.assign(new Error('ARI_EVENTS_WORKER_ALREADY_RUNNING'), { code: 'ARI_EVENTS_WORKER_ALREADY_RUNNING' });
  console.log(JSON.stringify({ ariEvents: 'worker_started', workerId }));
}).catch(async error => {
  console.error(JSON.stringify({ ariEvents: 'worker_failed', code: /^[A-Z0-9_]{2,80}$/.test(error.code || '') ? error.code : 'ARI_EVENTS_WORKER_FAILED' }));
  await stop();
  process.exitCode = 1;
});
