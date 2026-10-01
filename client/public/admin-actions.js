(() => {
  if (window.__gbotAdminActionsLoaded) return;
  window.__gbotAdminActionsLoaded = true;

  const css = `
    .salemax-admin-action{font:600 14px/1.2 Arial,sans-serif;border:0;border-radius:9px;padding:10px 16px;background:#a8003b;color:#fff;cursor:pointer;box-shadow:0 2px 8px #a8003b25}
    .salemax-admin-action:hover{background:#860030}.salemax-admin-edit-plan{width:100%;margin:0 0 8px;background:#fff2f6;color:#860030;border:1px solid #edbfd0;box-shadow:none}
    .salemax-admin-edit-plan:hover{background:#ffe5ee}.salemax-admin-overlay{position:fixed;inset:0;z-index:2147483000;background:#10182880;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}
    .salemax-admin-modal{width:min(680px,100%);max-height:92vh;overflow:auto;background:#fff;color:#17212f;border-radius:16px;padding:24px;box-shadow:0 18px 70px #10182845;font:14px/1.45 Arial,sans-serif}
    .salemax-admin-modal h2{margin:0 0 5px;font-size:22px}.salemax-admin-modal p{margin:0 0 18px;color:#667085}.salemax-admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.salemax-admin-field{display:flex;flex-direction:column;gap:6px}.salemax-admin-field.full{grid-column:1/-1}.salemax-admin-field label,.salemax-admin-checks label{font-weight:600;color:#344054}.salemax-admin-field input,.salemax-admin-field textarea,.salemax-admin-field select{box-sizing:border-box;width:100%;border:1px solid #d0d5dd;border-radius:8px;padding:10px 11px;font:14px Arial,sans-serif;color:#17212f;background:#fff}.salemax-admin-field textarea{min-height:74px;resize:vertical}.salemax-admin-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:14px 0}.salemax-admin-checks label{display:flex;gap:8px;align-items:center;font-weight:500}.salemax-admin-checks input{accent-color:#a8003b}.salemax-admin-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.salemax-admin-secondary{border:1px solid #d0d5dd;border-radius:8px;padding:10px 16px;background:#fff;color:#344054;cursor:pointer}.salemax-admin-error{display:none;margin-top:12px;padding:10px;border-radius:8px;background:#fff1f0;color:#b42318}
    @media(max-width:620px){.salemax-admin-modal{padding:18px}.salemax-admin-grid,.salemax-admin-checks{grid-template-columns:1fr}.salemax-admin-field.full{grid-column:auto}}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const token = () => localStorage.getItem('wacrm_admin');
  const api = async (path, body) => {
    const t = token();
    if (!t) throw new Error('Your admin session has expired. Please sign in again.');
    const response = await fetch(path, {method: body ? 'POST' : 'GET', headers:{Authorization:`Bearer ${t}`,...(body?{'Content-Type':'application/json'}:{})}, body:body?JSON.stringify(body):undefined});
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.msg || 'Request failed. Please try again.');
    return data;
  };
  const field = (name,label,value='',type='text',full=false,required=false) => `<div class="salemax-admin-field${full?' full':''}"><label for="gbot-${name}">${label}${required?' *':''}</label><input id="gbot-${name}" name="${name}" type="${type}" value="${String(value ?? '').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}" ${required?'required':''} ${type==='number'?'step="any"':''}></div>`;
  const check = (name,label,value) => `<label><input type="checkbox" name="${name}" ${value?'checked':''}>${label}</label>`;
  const openModal = (title,subtitle,formHtml,onSave,saveLabel) => {
    const overlay=document.createElement('div'); overlay.className='salemax-admin-overlay';
    overlay.innerHTML=`<section class="salemax-admin-modal" role="dialog" aria-modal="true" aria-labelledby="gbot-modal-title"><h2 id="gbot-modal-title">${title}</h2><p>${subtitle}</p><form><div class="salemax-admin-grid">${formHtml}</div><div class="salemax-admin-error" role="alert"></div><div class="salemax-admin-footer"><button type="button" class="salemax-admin-secondary">Cancel</button><button class="salemax-admin-action" type="submit">${saveLabel}</button></div></form></section>`;
    const close=()=>overlay.remove(); overlay.addEventListener('click',e=>{if(e.target===overlay)close()}); overlay.querySelector('.salemax-admin-secondary').onclick=close;
    overlay.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,submit=form.querySelector('[type=submit]'),err=form.querySelector('.salemax-admin-error');submit.disabled=true;submit.textContent='Saving…';err.style.display='none';try{await onSave(new FormData(form));close();window.location.reload()}catch(ex){err.textContent=ex.message;err.style.display='block';submit.disabled=false;submit.textContent=saveLabel}});
    document.body.appendChild(overlay); overlay.querySelector('input,textarea,select')?.focus();
  };
  const openPlan = title => window.salemaxPlanEditor?.open(title);
  const openUser = async () => {
    try {
      const plans=(await api('/api/admin/get_plans')).data;
      const options=['<option value="">No plan</option>',...plans.map(p=>`<option value="${p.id}">${String(p.title).replaceAll('&','&amp;').replaceAll('<','&lt;')}</option>`)].join('');
      const html=field('name','Full name','','text',true,true)+field('email','Email address','','email',false,true)+field('mobile_with_country_code','Mobile number (with country code)','','tel',false,true)+field('password','Temporary password (minimum 8 characters)','','password',true,true)+`<div class="salemax-admin-field full"><label for="gbot-planId">Assign plan (optional)</label><select id="gbot-planId" name="planId">${options}</select></div>`;
      openModal('Add User','Create a user account. The password is saved securely as a hash.',html,async f=>await api('/api/admin/add_user',{name:f.get('name'),email:f.get('email'),mobile_with_country_code:f.get('mobile_with_country_code'),password:f.get('password'),planId:f.get('planId')}),'Create User');
    }catch(e){alert(e.message)}
  };
  const actionButton=(label,cls,handler)=>{const b=document.createElement('button');b.type='button';b.className='salemax-admin-action '+(cls||'');b.textContent=label;b.addEventListener('click',handler);return b};
  function mount(){
    if(location.pathname.toUpperCase()!=='/ADMIN' || !token()) return;
    const page=new URLSearchParams(location.search).get('page');
    if(page==='manage-plans'){
      document.querySelectorAll('.MuiCard-root').forEach(card=>{
        const title=card.querySelector('h6')?.textContent?.trim();
        const actions=card.querySelector('.MuiCardContent-root')?.lastElementChild;
        if(!title||!actions) return;
        const label = [...document.querySelectorAll('h5')].some(node => node.textContent.trim() === 'إدارة الخطط') ? 'تعديل الخطة' : 'Edit Plan';
        const existingButton = actions.querySelector('.salemax-admin-edit-plan');
        if(existingButton) {if(existingButton.textContent !== label) existingButton.textContent = label;return;}
        actions.style.display='grid';actions.style.gap='0';
        actions.insertBefore(actionButton(label,'salemax-admin-edit-plan',()=>openPlan(title)),actions.firstChild);
      });
    }
    if(page==='manage-users'){
      const refresh=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Refresh');
      const heading=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(e=>e.textContent.trim()==='Manage Users');
      const container=refresh?.parentElement || heading?.parentElement;
      if(container&&!container.querySelector('.salemax-admin-add-user')){
        const b=actionButton('Add User','salemax-admin-add-user',openUser);b.style.marginRight='8px';
        container.insertBefore(b,refresh||container.firstChild);
      }
    }
  }
  const observer=new MutationObserver(mount); observer.observe(document.documentElement,{childList:true,subtree:true});
  mount(); setInterval(mount,900);
})();

