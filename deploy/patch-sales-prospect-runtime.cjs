'use strict';
const fs=require('node:fs');
const file=process.argv[2];
if(!file)throw new Error('Usage: node patch-sales-prospect-runtime.cjs <production-server.js>');
let source=fs.readFileSync(file,'utf8');
function insertOnce(anchor,addition,label){
  if(source.includes(addition))return;
  const count=source.split(anchor).length-1;
  if(count!==1)throw new Error(`Expected one ${label} anchor in ${file}; found ${count}`);
  source=source.replace(anchor,anchor+addition);
}
insertOnce('let businessNotificationRuntime = null;\n','let salesProspectReminderRuntime = null;\n','runtime declaration');
insertOnce("  businessNotificationRuntime = require('./modules/platform/business-notifications').start();\n","  salesProspectReminderRuntime = require('./modules/platform/chatbot-sales-prospect-reminders').start();\n",'runtime start');
insertOnce('  businessNotificationRuntime?.stop();\n','  salesProspectReminderRuntime?.stop();\n','runtime cleanup');
fs.writeFileSync(file,source);
