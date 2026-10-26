'use strict';const fs=require('node:fs');const root=process.argv[2]||'/app/client/public';const file=root+'/pipeline/reports.js';let s=fs.readFileSync(file,'utf8');
for(const [heading,kind] of [['dateColumn','daily'],['agentName','agents']]){
 const token="<table class=\"report-table report-simple-table\"><thead><tr><th>${t('"+heading+"')}";
 if(s.split(token).length!==2)throw Error('Expected one '+kind+' report table');
 s=s.replace(token,token.replace('report-simple-table','report-simple-table report-'+kind+'-table'));
}
const a='<td>${fmtCount(agent.assignedLeads)}</td><td><strong>${fmtCount(agent.attendedLeads)}</strong></td>';
if(s.split(a).length!==2)throw Error('Expected one agent metric row');s=s.replace(a,'<td data-label="${escape(t(\'assignedNow\'))}">${fmtCount(agent.assignedLeads)}</td><td data-label="${escape(t(\'attendedCount\'))}"><strong>${fmtCount(agent.attendedLeads)}</strong></td>');fs.writeFileSync(file,s);
const shell=root+'/pipeline/index.html';let h=fs.readFileSync(shell,'utf8');const refs=h.match(/pipeline\/reports\.js\?v=[^"'\s<>]+/g);if(refs?.length!==1)throw Error('Expected one reports loader');h=h.replace(refs[0],'pipeline/reports.js?v=20261026-mobile-report1');if(h.includes('/pipeline/reports-mobile.css'))throw Error('Report stylesheet already exists');h=h.replace('</head>','<link rel="stylesheet" href="/pipeline/reports-mobile.css?v=20261026-compact1"></head>');if(!h.includes('/pipeline/reports-mobile.css'))throw Error('Missing stylesheet insertion');fs.writeFileSync(shell,h);
