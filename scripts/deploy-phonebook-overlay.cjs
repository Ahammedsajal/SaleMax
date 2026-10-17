'use strict';
// Apply this incremental feature to a copy of the resolved live release.
// Preserve live-generated HTML and the existing live Pipeline opening router.
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8');
const write=(file,text)=>{const destination=path.join(target,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,text);};
function insert(file,anchor,content){let text=read(target,file);if(text.includes(content.trim()))return;if(text.split(anchor).length!==2)throw Error('AMBIGUOUS_ANCHOR:'+file);write(file,text.replace(anchor,content+anchor));}
insert('server.js','app.use("/api/phonebook",','app.use("/api/phonebook/workspace", require("./modules/platform/phonebook-workspace-router")());\napp.use("/api/agent/phonebook", require("./modules/platform/phonebook-workspace-router")({agent:true}));\n');
const inbox=read(source,'helper/inbox/inbox.js');const start=inbox.indexOf("      try {\n        await require('../../modules/platform/phonebook-workspace').routeOpening");const end=inbox.indexOf('      // Process the message through the flow builder',start);if(start<0||end<0)throw Error('SOURCE_ROUTING_BLOCK_MISSING');
const liveInbox=read(target,'helper/inbox/inbox.js');const anchor=liveInbox.includes('      const openingRoute=')?'      const openingRoute=':'      // Process the message through the flow builder';insert('helper/inbox/inbox.js',anchor,inbox.slice(start,end));
insert('client/public/index.html','</head>','<link rel="stylesheet" href="/phonebook-workspace.css?v=20261017-1">\n<script defer src="/phonebook-workspace.js?v=20261017-1"></script>\n');
const guard='modules/platform/team-role-request-guard.js';insert(guard,"  if(mount==='/api/phonebook')","  if(mount==='/api/agent/phonebook')return ['GET','HEAD'].includes(method)||['/contacts','/values'].includes(path)?'contacts.read':'contacts.manage';\n  if(mount==='/api/phonebook/workspace')return read||['/contacts','/values'].includes(path)?'contacts.read':'contacts.manage';\n");let guardText=read(target,guard);guardText=guardText.replace("['/api/agent','/api/pipeline'].includes","['/api/agent','/api/agent/phonebook','/api/pipeline'].includes");write(guard,guardText);
for(const file of ['client/public/phonebook-workspace.css','client/public/phonebook-workspace.js','modules/platform/phonebook-workspace.js','modules/platform/phonebook-workspace-router.js','database/migrations/20261212_phonebook_workspace.sql'])write(file,read(source,file));
console.log('Phonebook overlay applied; live shell and pre-existing inbox routing preserved.');
