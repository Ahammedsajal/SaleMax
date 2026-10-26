'use strict';
const fs=require('node:fs');
const file='/app/modules/platform/mount-existing-upgrade.js';
const text=fs.readFileSync(file,'utf8');
const before="app.use('/api/user/chatbots',createChatbotRouter";
if(text.split(before).length!==2)throw Error('Unexpected chatbot mount; review live source');
fs.writeFileSync(file,text.replace(before,"app.use(['/api/workspace/chatbots','/api/user/chatbots'],createChatbotRouter"));
const index='/app/client/public/index.html';
let html=fs.readFileSync(index,'utf8');
for(const asset of ['training-sidebar.js','workspace-api.js']) {
  const re=new RegExp('(/'+asset.replace('.', '\\.')+')(?:\\?[^"\\s>]*)?','g');
  if(!re.test(html))throw Error('Missing shell asset '+asset);
  html=html.replace(re,'$1?v=20261026-chatbot-context-routing1');
}
fs.writeFileSync(index,html);
