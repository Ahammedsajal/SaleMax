(() => {
  'use strict';
  if(window.__sxAgentTransfer)return;window.__sxAgentTransfer=true;
  const ar=()=>String(localStorage.getItem('language')||localStorage.getItem('salemax-language')||'').startsWith('ar');
  const text=(en,arabic)=>ar()?arabic:en;
  let loading=false;
  const chat=()=>{try{return JSON.parse(localStorage.getItem('currentChat')||'null');}catch{return null;}};
  async function api(path,body){
    const response=await fetch('/api/agent/invitations/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('wacrm_agent')},body:body?JSON.stringify(body):undefined});
    const result=await response.json();if(!response.ok||!result.success)throw Error(result.code||'TRANSFER_FAILED');return result.data;
  }
  async function mount(){
    if(loading||!/^\/agent\/?$/.test(location.pathname))return;
    const current=chat();if(!current?.chat_id)return;
    const anchor=Array.from(document.querySelectorAll('button')).find(el=>['Close Chat','إغلاق المحادثة'].includes(el.textContent.trim()));
    if(!anchor)return;
    const old=document.getElementById('sx-agent-transfer');
    if(old?.dataset.chatId===current.chat_id)return;old?.remove();
    loading=true;
    try{
      const result=await api('conversation-staff?chatId='+encodeURIComponent(current.chat_id));
      if(chat()?.chat_id!==current.chat_id||!anchor.isConnected)return;
      const box=document.createElement('form');box.id='sx-agent-transfer';box.dataset.chatId=current.chat_id;
      box.style.cssText='display:grid;gap:8px;margin:12px 0;font:inherit';
      const label=document.createElement('label');label.textContent=text('Transfer chat to','تحويل المحادثة إلى');
      const select=document.createElement('select');select.required=true;select.setAttribute('aria-label',label.textContent);select.style.cssText='padding:10px;border:1px solid #ddd;border-radius:6px;background:white;color:#17212f';
      const empty=document.createElement('option');empty.value='';empty.textContent=text('Choose staff member','اختر موظفاً');select.append(empty);
      for(const member of result.staff){const option=document.createElement('option');option.value=member.identityId;option.textContent=member.name;select.append(option);}
      const button=document.createElement('button');button.type='submit';button.textContent=text('Transfer chat','تحويل المحادثة');button.style.cssText='padding:10px;border:0;border-radius:6px;background:#a8003b;color:white;cursor:pointer';
      const status=document.createElement('div');status.setAttribute('role','status');
      box.append(label,select,button,status);anchor.parentElement.before(box);
      box.onsubmit=async event=>{event.preventDefault();if(!select.value||chat()?.chat_id!==current.chat_id)return;button.disabled=true;
        try{await api('conversation-transfer',{chatId:current.chat_id,identityId:select.value});status.textContent=text('Chat transferred.','تم تحويل المحادثة.');}
        catch{status.textContent=text('Unable to transfer. Check your assignment and try again.','تعذر التحويل. تحقق من تعيين المحادثة وحاول مجدداً.');button.disabled=false;}
      };
    }catch{/* Only authorized assigned chats expose transfer controls. */}finally{loading=false;}
  }
  window.setInterval(mount,1500);
})();
