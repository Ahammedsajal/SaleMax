'use strict';
// Overlay maintained files onto a copy of the resolved live release. Do not
// replace the generated shell, live routing or unrelated production modules.
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8');
const write=(file,text)=>{const destination=path.join(target,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,text);};
function insert(file,anchor,content){const text=read(target,file);if(text.includes(content.trim()))return;if(text.split(anchor).length!==2)throw Error('AMBIGUOUS_ANCHOR:'+file);write(file,text.replace(anchor,content+anchor));}
insert('server.js','app.use("/api/inbox", require("./routes/inbox"));','app.use("/api/inbox/course-replies", require("./modules/platform/course-quick-reply-router")());\napp.use("/api/agent/course-replies", require("./modules/platform/course-quick-reply-router")({agent:true}));\n');
insert('client/public/index.html','</head>','<link rel="stylesheet" href="/course-quick-replies.css?v=20261017-1">\n<script defer src="/course-quick-replies.js?v=20261017-1"></script>\n');
const guard='modules/platform/team-role-request-guard.js';
insert(guard,"  if(mount==='/api/inbox')","  if(['/api/inbox/course-replies','/api/agent/course-replies'].includes(mount))return read?'conversations.read':'conversations.reply';\n");
let text=read(target,guard);const anchor="['/api/agent','/api/agent/phonebook','/api/pipeline']";if(!text.includes("'/api/agent/course-replies','/api/inbox/course-replies']")){if(text.split(anchor).length!==2)throw Error('ROLE_SCOPE_ANCHOR_MISSING');text=text.replace(anchor,"['/api/agent','/api/agent/phonebook','/api/pipeline','/api/agent/course-replies','/api/inbox/course-replies']");write(guard,text);}
for(const file of ['client/public/course-quick-replies.css','client/public/course-quick-replies.js','modules/platform/course-quick-replies.js','modules/platform/course-quick-reply-router.js','modules/platform/course-reply-transport.js','database/migrations/20261213_course_reply_jobs.sql'])write(file,read(source,file));
console.log('Course reply overlay applied; existing shell and live routing preserved.');
