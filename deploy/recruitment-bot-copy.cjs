'use strict';
const fs=require('node:fs'),path=require('node:path');
const PROFILE_NAME='7Network Business Development Engineer Recruitment';
function profileConfig(source){
 const config=JSON.parse(JSON.stringify(source));config.guidedContent??={version:1,messages:{}};config.guidedContent.messages??={};
 Object.assign(config.guidedContent.messages,{
  welcome:{en:'Thanks for your interest in working with us! 👋',ar:'شكراً لاهتمامك بالعمل معنا! 👋'},
  menuPrompt:{en:'What would you like to know?',ar:'ما الذي تود معرفته؟'},
  button7Network:{en:'About 7Network',ar:'عن 7Network'},
 });
 if(config.guidedContent.messages.buttonSalemax)config.guidedContent.messages.buttonSalemax={en:'About 7Network',ar:'عن 7Network'};
 return config;
}
function rewriteFlow(source){
 const data=JSON.parse(JSON.stringify(source));let openings=0;
 const clean=s=>s.replace(/https?:\/\/crm\.salemax\.qa/gi,'https://7network.live').replace(/\bSaleMaX\b(?![.-])/gi,'7Network').replace(/Sitta Arbaa Sitta for Software Solutions/g,'7 Network Automations').replace(/IT\/SaaS Sales Associate/g,'Business Development Engineer');
 function walk(x){if(typeof x==='string')return clean(x);if(Array.isArray(x))return x.map(walk);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,walk(v)]));return x;}
 const rewritten=walk(data);
 for(const node of rewritten.nodes||[]){const body=node?.data?.content?.interactive?.body;if(typeof body?.text==='string'&&body.text.includes('CR 251489')){body.text=require('../modules/platform/chatbot-recruitment-guide').recruitmentReply({message:'hi',facts:[],config:profileConfig({}).guidedContent}).reply;openings++;}}
 if(openings!==1)throw Error('EXPECTED_ONE_RECRUITMENT_OPENING');
 return rewritten;
}
function patchStatic(root){
 const edits=[['modules/platform/recruitment-router.js',"role:'Remote IT/SaaS Sales Associate — India'","role:'Business Development Engineer — Remote, India'"],['client/public/recruitment-application.html','7Network Sales Associate Application','7Network Business Development Engineer Application']];
 for(const [relative,before,after] of edits){const file=path.join(root,relative),s=fs.readFileSync(file,'utf8');if(s.includes(after))continue;if(s.split(before).length!==2)throw Error('COPY_ANCHOR_MISMATCH:'+relative);fs.writeFileSync(file,s.replace(before,after));}
}
if(require.main===module)patchStatic(process.argv[2]||'/app');
module.exports={PROFILE_NAME,profileConfig,rewriteFlow};
