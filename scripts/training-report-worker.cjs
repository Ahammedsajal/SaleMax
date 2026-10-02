'use strict';
require('dotenv').config();
if(process.env.SALEMAX_TRAINING_REPORT_WORKER_ENABLED!=='true')throw new Error('REPORT_WORKER_DISABLED');
const os=require('node:os');
const runner=require('../modules/platform/training-report-runner');
const pool=require('../database/config').promise();
const workerId=process.env.SALEMAX_REPORT_WORKER_ID||`reports-${os.hostname().replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,60)}-${process.pid}`;
const once=process.argv.includes('--once');
const interval=Number(process.env.SALEMAX_REPORT_WORKER_INTERVAL_MS||30000);
if(!Number.isSafeInteger(interval)||interval<5000||interval>300000)throw new Error('INVALID_REPORT_WORKER_INTERVAL');
let stopping=false,timer=null;
async function tick(){
  const result=await runner.tick(pool,{workerId,limit:10});
  if(result.queued||result.processed.length)console.log(JSON.stringify({queued:result.queued,duplicatePeriods:result.duplicatePeriods,processed:result.processed.map(item=>({status:item.status,errorCode:item.errorCode||undefined})),externallySent:false,externalWrites:false}));
}
async function stop(){if(stopping)return;stopping=true;if(timer)clearTimeout(timer);await pool.end();}
async function loop(){if(stopping)return;try{await tick();}catch(error){console.error(JSON.stringify({workerError:error.code||'REPORT_WORKER_FAILED',externallySent:false,externalWrites:false}));}if(!once&&!stopping)timer=setTimeout(loop,interval);else await stop();}
process.once('SIGINT',()=>stop().then(()=>process.exit(0)));
process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
loop().catch(async error=>{console.error(error.code||error.name||'REPORT_WORKER_FAILED');await stop();process.exitCode=1;});
