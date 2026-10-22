'use strict';

function targetForAgentEntry(requestUrl='/agent'){
  const url=new URL(requestUrl,'https://agent-entry.invalid');
  const requested=url.searchParams.get('page');
  const page=requested==='chat'?'inbox':requested==='my-tasks'?'tasks':requested||'dashboard';
  const query=new URLSearchParams();
  query.set('actor','agent');
  query.set('page',page);
  return `/user?${query.toString()}`;
}

function redirectAgentEntry(req,res){
  res.setHeader('Cache-Control','no-store');
  return res.redirect(302,targetForAgentEntry(req.originalUrl||req.url));
}

module.exports={targetForAgentEntry,redirectAgentEntry};
