'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const delivery=require('./training-receipt-delivery');
function start({env=process.env,spawnProcess=spawn,executable=process.execPath,root=path.resolve(__dirname,'..','..')}={}){
  if(env.SALEMAX_RECEIPT_EMAIL_ENABLED!=='true')return null;
  try{delivery.config(env);}catch{return null;}
  return spawnProcess(executable,[path.join(root,'scripts','training-receipt-worker.cjs')],{env,stdio:'inherit',windowsHide:true});
}
module.exports={start};
