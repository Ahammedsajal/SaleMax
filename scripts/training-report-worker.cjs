'use strict';
require('dotenv').config();
const readiness=require('./worker-readiness.cjs');
const readinessFile=process.env.SALEMAX_REPORT_WORKER_HEALTH_FILE||'/tmp/7network-report-worker-ready';
const readinessInterval=Number(process.env.SALEMAX_TRAINING_REPORT_WORKER_INTERVAL_MS||30000);
if(process.argv.includes('--healthcheck'))process.exit(readiness.isWorkerReady(readinessFile,{maxAgeMs:readinessInterval*3+30000})?0:1);
if(process.env.SALEMAX_TRAINING_REPORT_WORKER_ENABLED!=='true')throw new Error('REPORT_WORKER_DISABLED');
const os=require('node:os');
const runner=require('../modules/platform/training-report-runner');
const deliveryWorker=require('../modules/platform/training-report-delivery-worker');
const pool=require('../database/config').promise();
const {createPollingWorker}=require('./polling-worker.cjs');
const workerId=process.env.SALEMAX_REPORT_WORKER_ID||`reports-${os.hostname().replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,60)}-${process.pid}`;
const once=process.argv.includes('--once');
const interval=Number(process.env.SALEMAX_TRAINING_REPORT_WORKER_INTERVAL_MS||30000);
if(!Number.isSafeInteger(interval)||interval<5000||interval>300000)throw new Error('INVALID_REPORT_WORKER_INTERVAL');
async function tick(){
  const result=await runner.tick(pool,{workerId,limit:10});
  const registrationDelivery=await require('../modules/platform/training-registration-delivery').tick(pool);
  if(registrationDelivery.processed)console.log(JSON.stringify({registrationDelivery}));
  const delivery=await deliveryWorker.tick(pool,{workerId:`${workerId.slice(0,88)}-delivery`,limit:10});
  readiness.markWorkerReady(readinessFile);
  if(result.queued||result.processed.length||delivery.claimed)console.log(JSON.stringify({queued:result.queued,duplicatePeriods:result.duplicatePeriods,processed:result.processed.map(item=>({status:item.status,errorCode:item.errorCode||undefined,deliveriesQueued:item.deliveriesQueued})),delivery:{claimed:delivery.claimed,accepted:delivery.accepted,failed:delivery.failed,retrying:delivery.retrying,unknown:delivery.unknown},externallySent:delivery.externallySent,externalWrites:delivery.externalWrites}));
}
const worker=createPollingWorker({tick,intervalMs:interval,once,close:()=>pool.end(),onError:error=>console.error(JSON.stringify({workerError:error.code||'REPORT_WORKER_FAILED',externallySent:false,externalWrites:false}))});
process.once('SIGINT',()=>worker.stop().then(()=>process.exit(0)));
process.once('SIGTERM',()=>worker.stop().then(()=>process.exit(0)));
worker.start();
