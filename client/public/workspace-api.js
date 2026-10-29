(() => {
  'use strict';
  if(window.SaleMaxWorkspace)return;
  const paths={chatbots:'/api/workspace/chatbots',customization:'/api/workspace/customization',ai:'/api/workspace/ai',qr:'/api/workspace/channels/qr',flows:'/api/workspace/automation/flows',chatbot:'/api/workspace/automation/chatbot',templates:'/api/workspace/templates',campaigns:'/api/workspace/campaigns',inbox:'/api/workspace/inbox',inboxTranslation:'/api/workspace/inbox/translate',pipeline:'/api/workspace/pipeline',session:'/api/workspace/session',tasks:'/api/workspace/tasks',finance:'/api/workspace/finance',phonebook:'/api/workspace/phonebook',courseReplies:'/api/workspace/inbox/course-replies',products:'/api/workspace/products-services',properties:'/api/workspace/properties',team:'/api/workspace/team',courses:'/api/workspace/courses',students:'/api/workspace/students',profile:'/api/workspace/profile',forms:'/api/workspace/forms',icp:'/api/workspace/icp'};
  const actor=()=>window.SaleMaxActor==='agent'||/^\/agent\/?$/.test(location.pathname)?'agent':'user';
  async function headers(json=true,csrf=true){
    const kind=actor(),token=localStorage.getItem(kind==='agent'?'wacrm_agent':'wacrm_user');
    const value={Accept:'application/json',...(json?{'Content-Type':'application/json'}:{})};
    if(token){value.Authorization='Bearer '+token;value['X-Salemax-Actor']=kind;}
    else if(csrf){
      const response=await fetch('/api/user/business-auth/me',{credentials:'same-origin',cache:'no-store'});
      const session=await response.json();if(!response.ok||session.context?.audience!=='tenant')throw Error('AUTH_REQUIRED');
      value['X-CSRF-Token']=session.csrfToken;
    }
    return value;
  }
  const normalize=path=>path.replace(/^\/(accountant|canonical)(?=\/|\?|$)/,'');
  async function request(module,path='',{method='GET',body}={}){
    if(!paths[module])throw Error('UNKNOWN_WORKSPACE_MODULE');
    const file=body instanceof FormData;
    const response=await fetch(paths[module]+normalize(path),{method,credentials:'same-origin',cache:'no-store',headers:await headers(!file,!['GET','HEAD','OPTIONS'].includes(method.toUpperCase())),body:body===undefined?undefined:file?body:JSON.stringify(body)});
    let result;try{result=await response.json();}catch{throw Error('SERVER_ERROR');}
    if(!response.ok||result.success===false||result.success===0||result.logout){const error=Error(result.code||(result.logout?'AUTH_REQUIRED':'REQUEST_FAILED'));error.details=result.details;throw error;}
    return result;
  }
  let sessionPromise=null,sessionKey='',sessionUntil=0,sessionGeneration=0,sessionPending=false;
  const currentSessionKey=()=>{const kind=actor();return kind+':'+(localStorage.getItem(kind==='agent'?'wacrm_agent':'wacrm_user')||'cookie');};
  async function session(){
    const key=currentSessionKey();
    if(!sessionPromise||sessionKey!==key||(!sessionPending&&Date.now()>=sessionUntil)){
      sessionKey=key;sessionPending=true;sessionGeneration++;
      // Keep one request in flight per identity. The five-second reuse period
      // starts after success, never while a slow request is still pending.
      const pending=request('session').then(result=>{
        if(sessionPromise===pending){sessionPending=false;sessionUntil=Date.now()+5000;}
        return result.data;
      });
      sessionPromise=pending;
      pending.catch(()=>{if(sessionPromise===pending){sessionPromise=null;sessionPending=false;sessionUntil=0;}});
    }
    const generation=sessionGeneration,result=await sessionPromise;
    // A response begun under another identity must never paint its labels or
    // role navigation after an account switch or explicit invalidation.
    if(generation!==sessionGeneration||currentSessionKey()!==key)return session();
    return result;
  }
  const invalidateSession=()=>{sessionGeneration++;sessionPromise=null;sessionPending=false;sessionUntil=0;};
  window.SaleMaxWorkspace=Object.freeze({paths,headers,request,session,invalidateSession});
})();
