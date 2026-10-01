'use strict';
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const {bootstrap}=require('../modules/platform/bootstrap-super-admin');

function hidden(prompt){
  if(!stdin.isTTY||typeof stdin.setRawMode!=='function')throw Object.assign(new Error(),{code:'INTERACTIVE_TERMINAL_REQUIRED'});
  stdout.write(prompt);stdin.setEncoding('utf8');stdin.setRawMode(true);stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error,result)=>{stdin.off('data',onData);stdin.setRawMode(false);stdout.write('\n');error?reject(error):resolve(result);};
    const onData=chunk=>{
      for(const char of chunk){
        if(char==='\u0003')return finish(Object.assign(new Error(),{code:'CANCELLED'}));
        if(char==='\r'||char==='\n')return finish(null,value);
        if(char==='\u007f'||char==='\b'){value=Array.from(value).slice(0,-1).join('');continue;}
        if(char>=' '&&char!=='\u007f')value+=char;
      }
    };
    stdin.on('data',onData);
  });
}
async function main(){
  const args=process.argv.slice(2),idIndex=args.indexOf('--legacy-admin-id');
  if(idIndex<0||!/^\d+$/.test(args[idIndex+1]||''))throw Object.assign(new Error(),{code:'USAGE'});
  stdout.write('One-time SaleMaX platform owner setup. This can run only before any platform membership exists.\n');
  stdout.write('Verify in the existing admin records that this account belongs to the product owner.\n');
  const input=readline.createInterface({input:stdin,output:stdout});
  let confirmation,legacyUid;
  try{
    confirmation=await input.question('Type BOOTSTRAP PRODUCT OWNER to continue: ');
    legacyUid=await input.question('Existing admin UID (copied from the verified owner session): ');
  }finally{input.close();}
  const password=await hidden('Existing admin password (input hidden): ');
  const pool=require('../database/config').promise();
  try{
    const connection=await pool.getConnection();
    try{
      const result=await bootstrap(connection,{legacyAdminId:Number(args[idIndex+1]),legacyUid,password,confirmation});
      stdout.write(`Canonical Super Admin created for ${result.email} (identity ${result.identityId}).\n`);
      stdout.write('Sign in through the existing /admin flow and complete MFA setup before using protected platform controls.\n');
    }finally{connection.release();}
  }finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{stdout.write(`Bootstrap stopped: ${['USAGE','CANCELLED','INTERACTIVE_TERMINAL_REQUIRED'].includes(error.code)?error.code:(error.code||'FAILED')}\n`);process.exitCode=1;});
module.exports={main,hidden};
