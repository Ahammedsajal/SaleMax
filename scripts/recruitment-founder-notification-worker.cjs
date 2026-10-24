'use strict';
require('dotenv').config({quiet:true});
const readiness=require('./worker-readiness.cjs');
const readinessFile=process.env.SALEMAX_RECRUITMENT_FOUNDER_HEALTH_FILE||'/tmp/7network-recruitment-founder-worker-ready';
const readinessInterval=Number(process.env.SALEMAX_RECRUITMENT_FOUNDER_INTERVAL_MS||30000);
if(process.argv.includes('--healthcheck'))process.exit(readiness.isWorkerReady(readinessFile,{maxAgeMs:readinessInterval*3+30000})?0:1);
const os=require('node:os');
const runner=require('../modules/platform/recruitment-founder-notifications');
const pool=require('../database/config').promise();
const {createPollingWorker}=require('./polling-worker.cjs');
const workerId=process.env.SALEMAX_RECRUITMENT_FOUNDER_WORKER_ID||`founder-${os.hostname().replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,55)}-${process.pid}`;
const once=process.argv.includes('--once'),interval=Number(process.env.SALEMAX_RECRUITMENT_FOUNDER_INTERVAL_MS||30000);
if(process.env.SALEMAX_RECRUITMENT_FOUNDER_WORKER_ENABLED!=='true')throw new Error('RECRUITMENT_FOUNDER_WORKER_DISABLED');
if(!Number.isSafeInteger(interval)||interval<5000||interval>300000)throw new Error('INVALID_RECRUITMENT_FOUNDER_WORKER_INTERVAL');
async function tick(){const totals=await runner.tick(pool,{workerId,limit:20});readiness.markWorkerReady(readinessFile);if(totals.claimed)console.log(JSON.stringify(totals));}
const worker=createPollingWorker({tick,intervalMs:interval,once,close:()=>pool.end(),onError:error=>console.error(JSON.stringify({workerError:/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'RECRUITMENT_FOUNDER_WORKER_FAILED'}))});
process.once('SIGINT',()=>worker.stop().then(()=>process.exit(0)));
process.once('SIGTERM',()=>worker.stop().then(()=>process.exit(0)));
worker.start();
