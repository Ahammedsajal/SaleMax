(() => {
  'use strict';
  const root=document.getElementById('organization');
  const $=selector=>root.querySelector(selector);
  const ar=()=>{const value=(localStorage.getItem('language')||'').toLowerCase();return value==='ar'||value.includes('arab');};
  const tr=(en,arabic)=>ar()?arabic:en;
  const state={members:[],canReassign:false,role:'',busy:false,query:'',roleFilter:'all'};
  const roles={owner:['Business Admin','مسؤول النشاط'],manager:['Sales Manager','مدير المبيعات'],team_leader:['Team Leader','قائد الفريق'],agent:['Sales Agent','وكيل المبيعات'],accountant:['Accountant','المحاسب']};
  const endpoint='/api/user/sales-organization';
  const text=(selector,value)=>{const node=$(selector);if(node)node.textContent=value;};
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function notice(message,kind=''){const node=$('#notice');node.textContent=message;node.dataset.kind=kind;}
  function api(path='',options={}){
    const token=localStorage.getItem('wacrm_user');
    return fetch(endpoint+path,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(options.headers||{})}}).then(async response=>{
      const body=await response.json().catch(()=>({}));
      if(!response.ok||body.success!==true)throw Object.assign(new Error(body.code||'REQUEST_FAILED'),{code:body.code||'REQUEST_FAILED',status:response.status});
      return body.data;
    });
  }
  function roleName(role){const value=roles[role]||[role||'Staff',role||'موظف'];return tr(...value);}
  function personName(member){return member.displayName||member.email||tr('Team member','عضو الفريق');}
  function summaryCard(label,value){return `<article class="summary-card"><span>${escape(label)}</span><strong>${escape(value)}</strong></article>`;}
  function filteredMembers(){
    const query=state.query.trim().toLocaleLowerCase();
    const matches=state.members.filter(member=>{
      if(state.roleFilter!=='all'&&member.role!==state.roleFilter)return false;
      return !query||[member.displayName,member.email,member.managerName,member.teamLeaderName,member.role].some(value=>String(value||'').toLocaleLowerCase().includes(query));
    });
    // Keep reporting-line context when a search or role filter selects a nested person.
    const visible=new Set(matches.map(member=>member.membershipId));
    for(const member of matches){
      if(member.teamLeaderMembershipId)visible.add(member.teamLeaderMembershipId);
      if(member.managerMembershipId)visible.add(member.managerMembershipId);
    }
    return state.members.filter(member=>visible.has(member.membershipId));
  }
  function memberCard(member,showMove=true){
    const label=roleName(member.role),reporting=member.role==='agent'?[member.managerName,member.teamLeaderName].filter(Boolean).join(' · '):member.role==='team_leader'?member.managerName||'':'';
    const safeId=escape(member.membershipId);
    return `<article class="org-member" data-member="${safeId}"><div class="member-main"><span class="member-name">${escape(personName(member))}</span><span class="member-email">${escape(member.email||'')}</span><div class="member-meta"><span class="role-badge ${escape(member.role)}">${escape(label)}</span>${reporting?`<span class="scope-badge">${escape(tr('Reports to','يتبع إلى'))}: ${escape(reporting)}</span>`:''}</div></div>${showMove&&state.canReassign&&['team_leader','agent'].includes(member.role)?`<div class="member-actions"><button class="secondary" type="button" data-move-member="${safeId}">${escape(tr('Change team','تغيير الفريق'))}</button></div>`:''}</article>`;
  }
  function renderTree(members){
    const host=$('#orgTree');
    const managers=members.filter(member=>member.role==='manager'),leaders=members.filter(member=>member.role==='team_leader'),agents=members.filter(member=>member.role==='agent'),owners=members.filter(member=>member.role==='owner'),accountants=members.filter(member=>member.role==='accountant');
    const usedLeaders=new Set(),usedAgents=new Set();
    const managerGroups=managers.map(manager=>{
      const managerLeaders=leaders.filter(leader=>leader.managerMembershipId===manager.membershipId);
      const level=document.createElement('div');level.className='org-level';
      for(const leader of managerLeaders){
        usedLeaders.add(leader.membershipId);
        const leaderAgents=agents.filter(agent=>agent.teamLeaderMembershipId===leader.membershipId);
        leaderAgents.forEach(agent=>usedAgents.add(agent.membershipId));
        const node=document.createElement('section');node.className='org-leader';node.innerHTML=memberCard(leader)+`<div class="org-agents">${leaderAgents.length?leaderAgents.map(agent=>memberCard(agent)).join(''):`<div class="empty">${escape(tr('No agents assigned yet.','لم يتم تعيين وكلاء بعد.'))}</div>`}</div>`;
        level.append(node);
      }
      const directAgents=agents.filter(agent=>agent.managerMembershipId===manager.membershipId&&!agent.teamLeaderMembershipId&&!usedAgents.has(agent.membershipId));
      directAgents.forEach(agent=>usedAgents.add(agent.membershipId));
      if(directAgents.length){const group=document.createElement('div');group.className='org-agents';group.innerHTML=`<p class="group-title">${escape(tr('Agents needing a team leader','وكلاء بحاجة إلى قائد فريق'))}</p>${directAgents.map(agent=>memberCard(agent)).join('')}`;level.append(group);}
      const article=document.createElement('section');article.className='org-manager';article.innerHTML=memberCard(manager,false);
      if(level.childElementCount)article.append(level);else{const empty=document.createElement('p');empty.className='muted';empty.textContent=tr('No team leaders or agents are assigned to this manager yet.','لم يتم تعيين قادة فرق أو وكلاء لهذا المدير بعد.');article.append(empty);}
      return article;
    });
    host.replaceChildren();
    if(owners.length){const group=document.createElement('section');group.className='org-unassigned';group.innerHTML=`<p class="group-title">${escape(tr('Business Admin','مسؤول النشاط'))}</p>${owners.map(member=>memberCard(member,false)).join('')}`;host.append(group);}
    managerGroups.forEach(group=>host.append(group));
    const unassignedLeaders=leaders.filter(leader=>!usedLeaders.has(leader.membershipId));
    const unassignedAgents=agents.filter(agent=>!usedAgents.has(agent.membershipId));
    if(unassignedLeaders.length||unassignedAgents.length){
      const group=document.createElement('section');group.className='org-unassigned';group.innerHTML=`<p class="group-title">${escape(tr('Needs a reporting assignment','بحاجة إلى تعيين إداري'))}</p>${unassignedLeaders.map(member=>memberCard(member)).join('')}${unassignedAgents.map(member=>memberCard(member)).join('')}`;host.append(group);
    }
    if(accountants.length){const group=document.createElement('section');group.className='org-accountants';group.innerHTML=`<p class="group-title">${escape(tr('Finance team','الفريق المالي'))}</p>${accountants.map(member=>memberCard(member,false)).join('')}`;host.append(group);}
    if(!host.childElementCount){host.innerHTML=`<div class="empty">${escape(tr('No active team members match these filters.','لا يوجد أعضاء نشطون يطابقون عوامل التصفية.'))}</div>`;}
    host.querySelectorAll('[data-move-member]').forEach(button=>button.addEventListener('click',()=>openMove(button.dataset.moveMember)));
  }
  function render(){
    const members=filteredMembers();
    const counts={manager:0,team_leader:0,agent:0,accountant:0};
    for(const member of state.members)if(Object.hasOwn(counts,member.role))counts[member.role]++;
    $('#summary').innerHTML=[summaryCard(tr('Sales Managers','مديرو المبيعات'),counts.manager),summaryCard(tr('Team Leaders','قادة الفرق'),counts.team_leader),summaryCard(tr('Sales Agents','وكلاء المبيعات'),counts.agent),summaryCard(tr('Finance staff','موظفو المالية'),counts.accountant)].join('');
    renderTree(members);
    $('#teamAccess').hidden=state.role!=='owner';
    text('#scopeNote',state.role==='owner'?tr('Business-wide reporting structure. Changes are audited and retain assignment history.','الهيكل التنظيمي للنشاط بالكامل. تُسجل التغييرات مع الاحتفاظ بسجل التعيينات.'):state.role==='manager'?tr('Your reporting scope. You can move team leaders or agents only within your own team.','نطاق فريقك. يمكنك نقل قادة الفرق أو الوكلاء ضمن فريقك فقط.'):tr('Read-only view of your team and reporting lines.','عرض للقراءة فقط لفريقك وتسلسله الإداري.'));
  }
  function roleOptions(){
    const select=$('#roleFilter'),current=select.value;
    const items=[['all',tr('All roles','كل الأدوار')],...Object.keys(roles).map(role=>[role,roleName(role)])];
    select.innerHTML=items.map(([value,label])=>`<option value="${escape(value)}">${escape(label)}</option>`).join('');select.value=items.some(([value])=>value===current)?current:'all';
  }
  function openMove(membershipId){
    const member=state.members.find(row=>row.membershipId===membershipId);if(!member)return;
    const dialog=$('#moveDialog'),form=$('#moveForm'),managerSelect=form.elements.managerMembershipId,leaderSelect=form.elements.teamLeaderMembershipId;
    form.reset();form.elements.membershipId.value=member.membershipId;
    text('#moveDescription',`${personName(member)} · ${roleName(member.role)}`);
    $('#teamLeaderField').hidden=member.role!=='agent';leaderSelect.required=member.role==='agent';
    const managers=state.members.filter(row=>row.role==='manager');
    managerSelect.innerHTML=`<option value="">${escape(tr('Select a manager','اختر مديرًا'))}</option>${managers.map(row=>`<option value="${escape(row.membershipId)}">${escape(personName(row))}</option>`).join('')}`;
    function fillLeaders(managerId){
      const leaders=state.members.filter(row=>row.role==='team_leader'&&row.managerMembershipId===managerId);
      leaderSelect.innerHTML=`<option value="">${escape(tr('Select a team leader','اختر قائد فريق'))}</option>${leaders.map(row=>`<option value="${escape(row.membershipId)}">${escape(personName(row))}</option>`).join('')}`;
    }
    managerSelect.onchange=()=>fillLeaders(managerSelect.value);
    managerSelect.value=member.managerMembershipId||'';fillLeaders(managerSelect.value);leaderSelect.value=member.teamLeaderMembershipId||'';
    form.elements.reason.value='';dialog.showModal();
  }
  async function load(){
    if(state.busy)return;state.busy=true;$('#refresh').disabled=true;notice(tr('Loading organization…','جارٍ تحميل الهيكل التنظيمي…'));
    try{const data=await api();state.members=Array.isArray(data.members)?data.members:[];state.canReassign=data.canReassign===true;state.role=data.role||'';roleOptions();render();notice('');}
    catch(error){state.members=[];render();const messages={PERMISSION_DENIED:tr('You do not have access to this team view.','ليس لديك صلاحية لعرض هذا الفريق.'),CATEGORY_UNAVAILABLE:tr('This page is available only in the SaleMaX Sales workspace.','هذه الصفحة متاحة فقط في مساحة مبيعات SaleMaX.'),FEATURE_UNAVAILABLE:tr('Team access is not included in the active plan.','إدارة الفريق غير متاحة في الخطة الحالية.')};notice(messages[error.code]||tr('Could not load the organization. Refresh and try again.','تعذر تحميل الهيكل التنظيمي. حدّث الصفحة وحاول مرة أخرى.'),'error');}
    finally{state.busy=false;$('#refresh').disabled=false;}
  }
  $('#search').addEventListener('input',event=>{state.query=event.currentTarget.value;render();});
  $('#roleFilter').addEventListener('change',event=>{state.roleFilter=event.currentTarget.value;render();});
  $('#refresh').addEventListener('click',load);
  $('#cancelMove').addEventListener('click',()=>$('#moveDialog').close());
  $('#closeMove').addEventListener('click',()=>$('#moveDialog').close());
  $('#moveForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
    const memberId=form.elements.membershipId.value,button=$('#saveMove');button.disabled=true;notice('');
    const payload={managerMembershipId:form.elements.managerMembershipId.value,reason:form.elements.reason.value.trim()};
    if($('#teamLeaderField').hidden)payload.teamLeaderMembershipId=null;else payload.teamLeaderMembershipId=form.elements.teamLeaderMembershipId.value;
    try{await api(`/${encodeURIComponent(memberId)}/reassign`,{method:'POST',body:JSON.stringify(payload)});$('#moveDialog').close();notice(tr('Team assignment updated.','تم تحديث تعيين الفريق.'),'success');await load();}
    catch(error){const messages={PERMISSION_DENIED:tr('You cannot move this person outside your team.','لا يمكنك نقل هذا الشخص خارج فريقك.'),INVALID_REASON:tr('Enter a short reason for this change.','أدخل سببًا مختصرًا لهذا التغيير.'),TEAM_LEADER_OUTSIDE_MANAGER:tr('Choose a team leader who reports to the selected manager.','اختر قائد فريق يتبع للمدير المحدد.'),INVALID_TEAM_LEADER:tr('Choose an active team leader.','اختر قائد فريق نشطًا.')};notice(messages[error.code]||tr('The assignment was not changed. Refresh and try again.','لم يتغير التعيين. حدّث الصفحة وحاول مرة أخرى.'),'error');}
    finally{button.disabled=false;}
  });
  window.addEventListener('storage',event=>{if(event.key==='language'){translate();render();}});
  function translate(){
    const arabic=ar();document.documentElement.lang=arabic?'ar':'en';document.documentElement.dir=arabic?'rtl':'ltr';
    text('#pageTitle',tr('Organization','الهيكل التنظيمي'));text('#intro',tr('See reporting lines and move team leaders or agents within your permitted scope.','اطلع على التسلسل الإداري وانقل قادة الفرق أو الوكلاء ضمن نطاق صلاحياتك.'));
    text('#teamAccess',tr('Team access','إدارة وصول الفريق'));text('#refresh',tr('Refresh','تحديث'));text('#teamHeading',tr('Reporting structure','الهيكل الإداري'));text('#searchLabel',tr('Search people','البحث عن الأشخاص'));text('#roleLabel',tr('Role','الدور'));
    text('#moveEyebrow',tr('TEAM CHANGE','تغيير الفريق'));text('#moveTitle',tr('Move team member','نقل عضو الفريق'));text('#managerLabel',tr('Sales Manager','مدير المبيعات'));text('#teamLeaderLabel',tr('Team Leader','قائد الفريق'));text('#reasonLabel',tr('Reason for change','سبب التغيير'));text('#cancelMove',tr('Cancel','إلغاء'));text('#saveMove',tr('Save assignment','حفظ التعيين'));
    roleOptions();
  }
  translate();load();
})();
