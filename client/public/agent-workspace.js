/* Adapt the existing business shell to an Agent session without replacing a
 * business user's saved credential or changing the authenticated identity. */
(() => {
 'use strict';
 const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem,originalRemove=Storage.prototype.removeItem;
 const raw=(key)=>originalGet.call(localStorage,key),params=new URLSearchParams(location.search);
 if(location.pathname==='/user/login'||params.get('actor')==='user')sessionStorage.removeItem('sx_workspace_actor');
 if(params.get('actor')==='agent')sessionStorage.setItem('sx_workspace_actor','agent');
 if(location.pathname.startsWith('/agent/login')){
  const enter=()=>{if(location.pathname.replace(/\/$/,'')==='/agent'&&raw('wacrm_agent')){sessionStorage.setItem('sx_workspace_actor','agent');location.replace('/user?actor=agent&page=dashboard');}};
  for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){const result=original.apply(this,args);enter();return result;};}
  addEventListener('popstate',enter);setInterval(enter,500);
 }
 const agentEntry=location.pathname.replace(/\/$/,'')==='/agent';
 if(agentEntry&&raw('wacrm_agent')){sessionStorage.setItem('sx_workspace_actor','agent');const page=params.get('page');location.replace('/user?actor=agent&page='+(page==='chat'?'inbox':page==='my-tasks'?'tasks':page||'dashboard'));return;}
 if(!['/user','/pipeline','/call-center','/sales-workspace','/tasks'].includes(location.pathname.replace(/\/$/,''))||sessionStorage.getItem('sx_workspace_actor')!=='agent')return;
 window.SaleMaxActor='agent';
 Storage.prototype.getItem=function(key){return originalGet.call(this,this===localStorage&&key==='wacrm_user'?'wacrm_agent':key);};
 Storage.prototype.setItem=function(key,value){return originalSet.call(this,this===localStorage&&key==='wacrm_user'?'wacrm_agent':key,value);};
 Storage.prototype.removeItem=function(key){const result=originalRemove.call(this,this===localStorage&&key==='wacrm_user'?'wacrm_agent':key);if(this===localStorage&&key==='wacrm_user')queueMicrotask(()=>location.replace('/agent/login'));return result;};
 const isApi=url=>{try{const u=new URL(url,location.href);return u.origin===location.origin&&u.pathname.startsWith('/api/');}catch{return false;}};
 const originalFetch=window.fetch;window.fetch=function(input,init={}){if(isApi(input instanceof Request?input.url:input)){const headers=new Headers(init.headers||(input instanceof Request?input.headers:undefined));headers.set('X-Salemax-Actor','agent');if(!headers.has('Authorization')&&raw('wacrm_agent'))headers.set('Authorization','Bearer '+raw('wacrm_agent'));init={...init,headers};}return originalFetch.call(this,input,init);};
 const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send,requests=new WeakSet();
 XMLHttpRequest.prototype.open=function(method,url,...args){requests.delete(this);if(isApi(url))requests.add(this);return originalOpen.call(this,method,url,...args);};
 XMLHttpRequest.prototype.send=function(...args){if(requests.has(this))this.setRequestHeader('X-Salemax-Actor','agent');return originalSend.apply(this,args);};
 const redirect=()=>{if(['/user/login','/user'].includes(location.pathname)&&!raw('wacrm_agent'))location.replace('/agent/login');};
 addEventListener('popstate',redirect);
})();
