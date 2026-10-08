'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const delivery=require('./training-receipt-delivery');
function start({env=process.env,spawnProcess=spawn,executable=process.execPath,root=path.resolve(__dirname,'..','..')}={}){
  const receiptOn=delivery.enabled(env),remindersOn=delivery.reminderEmailEnabled(env);if(!receiptOn&&!remindersOn)return null;
  try{delivery.smtpConfig(env);}catch{return null;}
  return spawnProcess(executable,[path.join(root,'scripts','training-receipt-worker.cjs')],{env,stdio:'inherit',windowsHide:true});
}
module.exports={start};
