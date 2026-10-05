'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const runner=require('./task-notification-runner');
function start({env=process.env,spawnProcess=spawn,executable=process.execPath,root=path.resolve(__dirname,'..','..')}={}){if(env.LOCAL_ONLY_MODE==='true')return null;return spawnProcess(executable,[path.join(root,'scripts','task-notification-worker.cjs')],{env,stdio:'inherit',windowsHide:true});}
module.exports={start};
