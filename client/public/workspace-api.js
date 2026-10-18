(() => {
  'use strict';
  if(window.SaleMaxWorkspace)return;
  const paths={session:'/api/workspace/session',finance:'/api/workspace/finance',phonebook:'/api/workspace/phonebook',courseReplies:'/api/workspace/inbox/course-replies',courses:'/api/workspace/courses',students:'/api/workspace/students',profile:'/api/workspace/profile',forms:'/api/workspace/forms'};
  const actor=()=>/^\/agent\/?$/.test(location.pathname)?'agent':'user';
  async function headers(json=true){
    const kind=actor(),token=localStorage.getItem(kind==='agent'?'wacrm_agent':'wacrm_user');
    const value={Accept:'application/json',...(json?{'Content-Type':'application/json'}:{})};
    if(token){value.Authorization='Bearer '+token;value['X-Salemax-Actor']=kind;}
    else{
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
    const response=await fetch(paths[module]+normalize(path),{method,credentials:'same-origin',cache:'no-store',headers:await headers(!file),body:body===undefined?undefined:file?body:JSON.stringify(body)});
    let result;try{result=await response.json();}catch{throw Error('SERVER_ERROR');}
    if(!response.ok||result.success===false||result.success===0||result.logout){const error=Error(result.code||(result.logout?'AUTH_REQUIRED':'REQUEST_FAILED'));error.details=result.details;throw error;}
    return result;
  }
  let sessionPromise=null,sessionKey='',sessionUntil=0;
  async function session(){
    const kind=actor(),key=kind+':'+(localStorage.getItem(kind==='agent'?'wacrm_agent':'wacrm_user')||'cookie');
    if(!sessionPromise||sessionKey!==key||Date.now()>sessionUntil){sessionKey=key;sessionUntil=Date.now()+5000;sessionPromise=request('session').then(result=>result.data).catch(error=>{sessionPromise=null;throw error;});}
    return sessionPromise;
  }
  window.SaleMaxWorkspace=Object.freeze({paths,headers,request,session});
})();
