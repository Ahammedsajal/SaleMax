'use strict';
require('dotenv').config({quiet:true});
const os=require('node:os');
const nodemailer=require('nodemailer');
const runner=require('../modules/platform/task-notification-runner');
let settings=null;try{settings=runner.config(process.env);}catch{}
const whatsapp=runner.whatsappConfig(process.env);
if(!settings&&!whatsapp)throw new Error('TASK_NOTIFICATION_WORKER_DISABLED');
const pool=require('../database/config').promise();
const workerId=process.env.SALEMAX_TASK_WORKER_ID||`tasks-${os.hostname().replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,55)}-${process.pid}`;
const once=process.argv.includes('--once'),interval=Number(process.env.SALEMAX_TASK_WORKER_INTERVAL_MS||10000);
if(!Number.isSafeInteger(interval)||interval<5000||interval>300000)throw new Error('INVALID_TASK_WORKER_INTERVAL');
const transport=settings?nodemailer.createTransport({host:settings.host,port:settings.port,secure:settings.secure,requireTLS:!settings.secure,auth:settings.auth,tls:{minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000}):null;
let stopping=false,timer=null;
async function tick(){const totals=await runner.tick(pool,{workerId,limit:20,transport,from:settings?.from,baseUrl:process.env.SALEMAX_PUBLIC_BASE_URL,whatsapp});if(totals.claimed)console.log(JSON.stringify(totals));}
async function stop(){if(stopping)return;stopping=true;if(timer)clearTimeout(timer);if(transport)await transport.close();await pool.end();}
async function loop(){if(stopping)return;try{await tick();}catch(error){console.error(JSON.stringify({workerError:/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'TASK_WORKER_FAILED'}));}if(!once&&!stopping)timer=setTimeout(loop,interval);else await stop();}
process.once('SIGINT',()=>stop().then(()=>process.exit(0)));
process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
loop().catch(async error=>{console.error(/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'TASK_WORKER_FAILED');await stop();process.exitCode=1;});
