(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const agentSession = () => !!localStorage.getItem('wacrm_agent');
  const arabic = () => document.documentElement.lang?.toLowerCase().startsWith('ar');
  const copy = {
    en: {
      title:'Activity reports', subtitle:'A clear record of lead ownership, outcomes and the next follow-up.',
      ownerScope:'All workspace activity', agentScope:'Only leads currently assigned to you', period:'Period', daily:'Daily', weekly:'Weekly', monthly:'Monthly',
      date:'Report date', apply:'Run report', loading:'Preparing your report…', empty:'No lead notes or outcomes were recorded in this period.',
      failed:'We could not load this report. Your data is unchanged.', retry:'Try again', created:'Leads created', touched:'Leads touched', outcomes:'Contact outcomes', notes:'Notes added',
      followUpsRequired:'Follow-ups requested', followUpsDue:'Follow-ups due in period', overdue:'Open follow-ups overdue now', outcomeBreakdown:'Outcome breakdown',
      occurred:'Time', lead:'Lead / contact', attended:'Handled by', activity:'Activity', details:'Outcome or note', followUp:'Next follow-up',
      exportPage:'Export this page (CSV)', exportReady:'Report page downloaded as CSV.',
      financeTitle:'Finance summary',financeScope:'Invoices issued in this selected period; collected and outstanding are current when the report runs.',issuedInvoices:'Invoices issued',billed:'Billed',collected:'Collected on these invoices',credited:'Credits issued',outstanding:'Outstanding now',netCollections:'Net collections this period',
      note:'Internal note', contactOutcome:'Contact outcome', followUpRequired:'Follow-up required', noFollowUp:'No follow-up required', previous:'Previous', next:'Next', page:'Page', of:'of',
      outcomesMap:{no_answer:'No answer',connected:'Connected',interested:'Interested',not_interested:'Not interested',follow_up_scheduled:'Follow-up scheduled',wrong_number:'Wrong number',requested_call:'Call requested',sale_requested:'Sale requested'},
      tasksTitle:'Follow-up queue',tasksSubtitle:'Every due action stays visible across pipeline stages.',allTasks:'All open follow-ups',overdueTasks:'Overdue',upcomingTasks:'Upcoming',tasksLoading:'Loading your follow-ups…',tasksEmpty:'No follow-ups match this view.',tasksFailed:'We could not load follow-ups. Your data is unchanged.',completeTask:'Complete',rescheduleTask:'Reschedule',saveTask:'Save date',dueAt:'Due',stage:'Stage',assignedTo:'Assigned to',learner:'Learner',openLead:'Open opportunity',taskTotal:'Open follow-ups',taskOverdue:'Overdue',taskUpcoming:'Upcoming',previousPage:'Previous',nextPage:'Next',taskCompleted:'Follow-up completed.',taskRescheduled:'Follow-up rescheduled.',dateRequired:'Choose the next date and time.'
    },
    ar: {
      title:'تقارير النشاط', subtitle:'سجل واضح لمسؤولية العملاء والنتائج والمتابعة التالية.',
      ownerScope:'نشاط مساحة العمل بالكامل', agentScope:'العملاء المسندون إليك حاليًا فقط', period:'الفترة', daily:'يومي', weekly:'أسبوعي', monthly:'شهري',
      date:'تاريخ التقرير', apply:'عرض التقرير', loading:'جارٍ إعداد التقرير…', empty:'لم تُسجل ملاحظات أو نتائج للعملاء خلال هذه الفترة.',
      failed:'تعذر تحميل التقرير. لم تتغير بياناتك.', retry:'إعادة المحاولة', created:'عملاء جدد', touched:'عملاء تمت متابعتهم', outcomes:'نتائج التواصل', notes:'ملاحظات مضافة',
      followUpsRequired:'متابعات مطلوبة', followUpsDue:'متابعات مستحقة خلال الفترة', overdue:'متابعات مفتوحة متأخرة الآن', outcomeBreakdown:'تفصيل النتائج',
      occurred:'الوقت', lead:'العميل / جهة الاتصال', attended:'تمت المتابعة بواسطة', activity:'النشاط', details:'النتيجة أو الملاحظة', followUp:'المتابعة التالية',
      exportPage:'تصدير هذه الصفحة (CSV)', exportReady:'تم تنزيل صفحة التقرير بصيغة CSV.',
      financeTitle:'الملخص المالي',financeScope:'الفواتير الصادرة خلال الفترة المحددة؛ يعرض المحصل والمتبقي حتى وقت إعداد التقرير.',issuedInvoices:'الفواتير الصادرة',billed:'إجمالي الفواتير',collected:'المحصل لهذه الفواتير',credited:'الإشعارات الدائنة',outstanding:'المتبقي الآن',netCollections:'صافي التحصيل خلال الفترة',
      note:'ملاحظة داخلية', contactOutcome:'نتيجة التواصل', followUpRequired:'المتابعة مطلوبة', noFollowUp:'لا توجد متابعة مطلوبة', previous:'السابق', next:'التالي', page:'صفحة', of:'من',
      outcomesMap:{no_answer:'لا يوجد رد',connected:'تم التواصل',interested:'مهتم',not_interested:'غير مهتم',follow_up_scheduled:'تم تحديد متابعة',wrong_number:'رقم خاطئ',requested_call:'طلب اتصال',sale_requested:'طلب الشراء'},
      tasksTitle:'قائمة المتابعات',tasksSubtitle:'تظهر كل المتابعات المستحقة مهما كانت مرحلة الفرصة.',allTasks:'كل المتابعات المفتوحة',overdueTasks:'متأخرة',upcomingTasks:'قادمة',tasksLoading:'جارٍ تحميل المتابعات…',tasksEmpty:'لا توجد متابعات في هذا العرض.',tasksFailed:'تعذر تحميل المتابعات. لم تتغير بياناتك.',completeTask:'إكمال',rescheduleTask:'تأجيل',saveTask:'حفظ الموعد',dueAt:'موعد المتابعة',stage:'المرحلة',assignedTo:'المسؤول',learner:'المتعلم',openLead:'فتح الفرصة',taskTotal:'المتابعات المفتوحة',taskOverdue:'متأخرة',taskUpcoming:'قادمة',previousPage:'السابق',nextPage:'التالي',taskCompleted:'تم إكمال المتابعة.',taskRescheduled:'تم تأجيل المتابعة.',dateRequired:'اختر تاريخ ووقت المتابعة التاليين.'
    }
  };
  const t = key => (arabic()?copy.ar:copy.en)[key] || key;
  const outcomeLabel = key => (arabic()?copy.ar:copy.en).outcomesMap[key] || key || '—';
  const qatarToday = () => {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  };
  const formatDate = value => {
    if(!value)return '—';
    const normalized=typeof value==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)?value.replace(' ','T')+'Z':value;
    return new Intl.DateTimeFormat(arabic()?'ar-QA':'en-QA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Qatar'}).format(new Date(normalized));
  };
  const formatWindowDate = (value,end=false) => value ? new Intl.DateTimeFormat(arabic()?'ar-QA':'en-QA',{dateStyle:'medium',timeZone:'Asia/Qatar'}).format(new Date(Date.parse(value.replace(' ','T')+'Z')-(end?1:0))) : '—';
  const token = () => localStorage.getItem('wacrm_user') || localStorage.getItem('wacrm_agent');
  const state = {page:1,report:null,sequence:0,period:'daily',at:qatarToday(),taskPage:1,taskPeriod:'all',taskSequence:0,tasks:null};
  const host = $('#reports'), taskHost = $('#followups'), toolbar = $('.toolbar');
  if (!host || !$('#reportsMode')) return;

  function setView(view) {
    const reports = view === 'reports', followups = view === 'followups', summary = !reports && !followups;
    $('#summary').classList.toggle('hidden',!summary);
    $('#board').classList.toggle('hidden',reports || view !== 'board');
    $('#list').classList.toggle('hidden',reports || view !== 'list');
    host.classList.toggle('hidden',!reports);
    taskHost.classList.toggle('hidden',!followups);
    toolbar.classList.toggle('report-mode',reports || followups);
    for (const [id,active] of [['boardMode',view==='board'],['listMode',view==='list'],['reportsMode',reports],['followupsMode',followups]]) {
      const button=$('#'+id);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    }
    if(reports && !state.report) load();
    if(followups) loadFollowUps();
  }
  function shell(content) {
    const scope=agentSession()?t('agentScope'):t('ownerScope');
    return `<div class="report-head"><div><h2>${t('title')}</h2><p>${t('subtitle')}</p><span class="report-scope">${scope}</span></div>${state.report?.items?.length?`<button class="report-export" type="button" id="reportExport">${t('exportPage')}</button>`:''}</div>
      <form class="report-filters" id="reportFilters"><label>${t('period')}<select name="period"><option value="daily" ${state.period==='daily'?'selected':''}>${t('daily')}</option><option value="weekly" ${state.period==='weekly'?'selected':''}>${t('weekly')}</option><option value="monthly" ${state.period==='monthly'?'selected':''}>${t('monthly')}</option></select></label><label>${t('date')}<input name="at" type="date" value="${escape(state.at)}" required></label><button class="primary" type="submit">${t('apply')}</button></form>${content}`;
  }
  function loading() { host.innerHTML=shell(`<div class="report-state" role="status">${t('loading')}</div>`);bindFilters(); }
  function errorState() { host.innerHTML=shell(`<div class="report-state" role="alert">${t('failed')}<p><button class="report-retry" type="button" id="reportRetry">${t('retry')}</button></p></div>`);bindFilters();$('#reportRetry').onclick=load; }
  function bindFilters() {
    const form=$('#reportFilters');form.elements.period.value=state.period;form.elements.at.value=state.at;
    form.onsubmit=event=>{event.preventDefault();state.page=1;load();};
  }
  function metric(label,value) { return `<div class="report-kpi"><small>${escape(label)}</small><b>${escape(value)}</b></div>`; }
  function formatQarMinor(value){
    const amount=BigInt(String(value||'0')),locale=arabic()?'ar-QA':'en-QA',negative=amount<0n,absolute=negative?-amount:amount;
    const whole=new Intl.NumberFormat(locale,{maximumFractionDigits:0}).format(absolute/100n);
    const fraction=new Intl.NumberFormat(locale,{useGrouping:false,minimumIntegerDigits:2,maximumFractionDigits:0}).format(Number(absolute%100n));
    return `${negative?'−':''}${whole}.${fraction} ${arabic()?'ر.ق':'QAR'}`;
  }
  function render(report) {
    state.report=report;
    const s=report.summary||{};
    const metrics=[['created',s.leadsCreated],['touched',s.leadsTouched],['outcomes',s.outcomes],['notes',s.notes],['followUpsRequired',s.followUpsRequired],['followUpsDue',s.followUpsDue],['overdue',s.followUpsOverdue]];
    const breakdown=(s.outcomeCounts||[]).map(row=>`<span class="report-outcome">${escape(outcomeLabel(row.outcome))} · <b>${escape(row.total)}</b></span>`).join('')||`<span class="report-state">${escape(t('empty'))}</span>`;
    const rows=(report.items||[]).map(item=>{
      const outcome=item.details?.outcome;
      const activity=item.activityType==='note_added'?t('note'):t('contactOutcome');
      const detail=item.activityType==='note_added'?item.summary:[outcomeLabel(outcome),item.details?.followUpRequired===true?t('followUpRequired'):item.details?.followUpRequired===false?t('noFollowUp'):''].filter(Boolean).join(' · ');
      const followUp=item.details?.nextFollowUpAt||item.nextFollowUpAt;
      return `<tr><td>${escape(formatDate(item.occurredAt))}</td><td><button class="report-lead-link" type="button" data-lead="${escape(item.leadId)}">${escape(item.contactName||item.leadTitle||t('lead'))}</button><small>${escape(item.mobile||'')}</small></td><td>${escape(item.attendedBy||'—')}</td><td>${escape(activity)}</td><td class="report-detail">${escape(detail||'—')}</td><td>${escape(formatDate(followUp))}</td></tr>`;
    }).join('');
    const periodText=`${formatWindowDate(report.from)} – ${formatWindowDate(report.to,true)}`;
    const outcomeHtml=(s.outcomeCounts||[]).length?`<h3>${t('outcomeBreakdown')}</h3><div class="report-outcomes">${breakdown}</div>`:'';
    const finance=report.finance;
    const financeHtml=finance?`<section class="report-finance" aria-labelledby="reportFinanceTitle"><h3 id="reportFinanceTitle">${t('financeTitle')}</h3><p class="report-state">${t('financeScope')}</p><div class="report-kpis">${metric(t('issuedInvoices'),Number(finance.issuedInvoiceCount||0).toLocaleString(arabic()?'ar-QA':'en-QA'))}${metric(t('billed'),formatQarMinor(finance.billedMinor))}${metric(t('collected'),formatQarMinor(finance.collectedMinor))}${metric(t('credited'),formatQarMinor(finance.creditedMinor))}${metric(t('outstanding'),formatQarMinor(finance.outstandingMinor))}${metric(t('netCollections'),formatQarMinor(finance.netCollectionsMinor))}</div></section>`:'';
    const listHtml=report.total?`<div class="report-table-wrap"><table class="report-table"><thead><tr><th>${t('occurred')}</th><th>${t('lead')}</th><th>${t('attended')}</th><th>${t('activity')}</th><th>${t('details')}</th><th>${t('followUp')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <nav class="report-pagination" aria-label="Report pages"><button type="button" id="reportPrevious" ${report.page<=1?'disabled':''}>${t('previous')}</button><span>${t('page')} ${escape(report.page)} · ${report.total} ${t('of')} ${Math.max(1,Math.ceil(report.total/report.limit))}</span><button type="button" id="reportNext" ${report.hasMore?'':'disabled'}>${t('next')}</button></nav>`:`<div class="report-state">${t('empty')}</div>`;
    host.innerHTML=shell(`<p class="report-period">${escape(periodText)} · ${escape(report.timezone||'Asia/Qatar')}</p><div class="report-kpis">${metrics.map(([key,value])=>metric(t(key),Number(value||0).toLocaleString(arabic()?'ar-QA':'en-QA'))).join('')}</div>${outcomeHtml}${financeHtml}${listHtml}`);
    bindFilters();
    $('#reportExport')?.addEventListener('click',()=>exportCurrentPage(report));
    $('#reportPrevious')?.addEventListener('click',()=>{state.page=Math.max(1,state.page-1);load();});
    $('#reportNext')?.addEventListener('click',()=>{state.page++;load();});
    $$('.report-lead-link',host).forEach(button=>button.addEventListener('click',()=>window.salemaxPipelineOpenLead?.(button.dataset.lead)));
  }
  function exportCurrentPage(report) {
    const headers=[t('occurred'),t('lead'),t('attended'),t('activity'),t('details'),t('followUp')];
    const rows=(report.items||[]).map(item=>[
      formatDate(item.occurredAt),item.contactName||item.leadTitle||t('lead'),item.attendedBy||'',
      item.activityType==='note_added'?t('note'):t('contactOutcome'),
      item.activityType==='note_added'?item.summary:[outcomeLabel(item.details?.outcome),item.details?.followUpRequired===true?t('followUpRequired'):item.details?.followUpRequired===false?t('noFollowUp'):''].filter(Boolean).join(' · '),
      formatDate(item.details?.nextFollowUpAt||item.nextFollowUpAt)
    ]);
    const cell=value=>{
      let text=String(value??'').replace(/[\r\n]+/g,' ').trim();
      if(/^(?:[=+@]|-|\t)/.test(text))text="'"+text;
      return `"${text.replace(/"/g,'""')}"`;
    };
    const csv='\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`salemax-activity-${state.period}-${state.at}-page-${report.page}.csv`;link.hidden=true;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    const toast=$('#toast');if(toast){toast.textContent=t('exportReady');toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2500);}
  }
  async function load() {
    const request=++state.sequence;
    const existing=$('#reportFilters');
    if(existing){state.period=existing.elements.period.value;state.at=existing.elements.at.value||qatarToday();}
    const period=state.period,at=state.at;
    loading();
    try {
      const bearer=token();if(!bearer)throw new Error('auth');
      const query=new URLSearchParams({period,at,page:String(state.page),limit:'25'});
      const response=await fetch('/api/pipeline/reports/activity?'+query,{headers:{Authorization:`Bearer ${bearer}`,'Accept':'application/json'}});
      const body=await response.json().catch(()=>({}));
      if(request!==state.sequence)return;
      if(!response.ok||!body.success)throw new Error(body.message||'report');
      render(body.data);
    }catch(_){if(request===state.sequence)errorState();}
  }
  const reportButton=$('#reportsMode');
  reportButton.textContent=arabic()?'التقارير':'Reports';
  reportButton.setAttribute('aria-label',reportButton.textContent);
  reportButton.onclick=()=>setView('reports');
  $('#boardMode').addEventListener('click',()=>setView('board'));
  $('#listMode').addEventListener('click',()=>setView('list'));
  $('#refresh').addEventListener('click',()=>{if(!host.classList.contains('hidden'))load();});
  const followupButton=$('#followupsMode');
  followupButton.textContent=arabic()?'المتابعات':'Follow-ups';
  followupButton.setAttribute('aria-label',followupButton.textContent);
  followupButton.onclick=()=>setView('followups');
  window.salemaxPipelineReports={load,setView,loadFollowUps};

  function fmtTaskDate(value){return value?new Intl.DateTimeFormat(arabic()?'ar-QA':'en-QA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Qatar'}).format(new Date(Date.parse(String(value).replace(' ','T')+'Z'))):'—';}
  function taskInputDate(value){if(!value)return '';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.parse(String(value).replace(' ','T')+'Z')));const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;}
  function taskShell(content){const d=state.tasks?.summary||{total:0,overdue:0,upcoming:0};const scope=agentSession()?t('agentScope'):t('ownerScope');return `<div class="report-head"><div><h2>${t('tasksTitle')}</h2><p>${t('tasksSubtitle')}</p><span class="report-scope">${scope}</span></div></div><div class="report-kpis"><div class="report-kpi"><small>${t('taskTotal')}</small><b>${d.total}</b></div><div class="report-kpi"><small>${t('taskOverdue')}</small><b>${d.overdue}</b></div><div class="report-kpi"><small>${t('taskUpcoming')}</small><b>${d.upcoming}</b></div></div><form class="report-filters" id="taskFilters"><label>${t('period')}<select name="period"><option value="all">${t('allTasks')}</option><option value="overdue">${t('overdueTasks')}</option><option value="upcoming">${t('upcomingTasks')}</option></select></label><button class="primary" type="submit">${t('apply')}</button></form>${content}`;}
  function taskError(){taskHost.innerHTML=taskShell(`<div class="report-state" role="alert">${t('tasksFailed')}<p><button class="report-retry" id="taskRetry" type="button">${t('retry')}</button></p></div>`);$('#taskFilters').elements.period.value=state.taskPeriod;$('#taskFilters').onsubmit=taskFilter;$('#taskRetry').onclick=loadFollowUps;}
  async function loadFollowUps(){const request=++state.taskSequence;taskHost.innerHTML=taskShell(`<div class="report-state" role="status">${t('tasksLoading')}</div>`);try{const query=new URLSearchParams({period:state.taskPeriod,page:String(state.taskPage),limit:'20'});const response=await fetch(`/api/pipeline/follow-ups?${query}`,{headers:{Authorization:`Bearer ${token()}`}});const body=await response.json().catch(()=>({}));if(request!==state.taskSequence)return;if(!response.ok||!body.success)throw new Error('follow-ups');state.tasks=body.data;renderTasks();}catch(_){if(request===state.taskSequence)taskError();}}
  function taskFilter(event){event.preventDefault();state.taskPeriod=event.currentTarget.elements.period.value;state.taskPage=1;loadFollowUps();}
  function renderTasks(){const data=state.tasks, rows=data.items||[];const content=rows.length?`<div class="followup-list">${rows.map(item=>`<article class="followup-card"><div class="followup-main"><div><h3>${escape(item.learner_name||item.relationship_name||item.contact_name||item.title)}</h3><p>${escape(item.title)}${item.mobile?` · ${escape(item.mobile)}`:''}</p></div><span class="badge ${Number(item.overdue)?'followup-overdue':''}">${Number(item.overdue)?t('overdueTasks'):t('upcomingTasks')}</span></div><div class="followup-meta"><span><b>${t('dueAt')}:</b> ${escape(fmtTaskDate(item.next_follow_up_at))}</span><span><b>${t('stage')}:</b> ${escape(item.stage_title||item.stage_key)}</span><span><b>${t('assignedTo')}:</b> ${escape(item.owner_name||'—')}</span></div><div class="followup-actions"><button class="report-retry" type="button" data-open-lead="${escape(item.lead_id)}">${t('openLead')}</button><button class="report-retry" type="button" data-complete="${escape(item.lead_id)}" data-due="${escape(item.due_revision)}">${t('completeTask')}</button><details><summary>${t('rescheduleTask')}</summary><form class="followup-reschedule" data-reschedule="${escape(item.lead_id)}" data-due="${escape(item.due_revision)}"><input type="datetime-local" name="at" value="${escape(taskInputDate(item.next_follow_up_at))}" required><button class="report-retry" type="submit">${t('saveTask')}</button></form></details></div></article>`).join('')}</div><div class="report-pagination"><button id="taskPrevious" type="button" ${data.page<=1?'disabled':''}>${t('previousPage')}</button><span>${t('page')} ${data.page} ${t('of')} ${Math.max(1,data.pages)}</span><button id="taskNext" type="button" ${data.page>=data.pages?'disabled':''}>${t('nextPage')}</button></div>`:`<div class="report-state">${t('tasksEmpty')}</div>`;taskHost.innerHTML=taskShell(content);$('#taskFilters').elements.period.value=state.taskPeriod;$('#taskFilters').onsubmit=taskFilter;$('#taskPrevious')?.addEventListener('click',()=>{state.taskPage=Math.max(1,state.taskPage-1);loadFollowUps();});$('#taskNext')?.addEventListener('click',()=>{state.taskPage+=1;loadFollowUps();});taskHost.querySelectorAll('[data-open-lead]').forEach(button=>button.addEventListener('click',()=>{setView('board');window.salemaxPipelineOpenLead?.(button.dataset.openLead);}));taskHost.querySelectorAll('[data-complete]').forEach(button=>button.addEventListener('click',()=>resolveTask(button.dataset.complete,'complete',undefined,button.dataset.due)));taskHost.querySelectorAll('[data-reschedule]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();resolveTask(form.dataset.reschedule,'reschedule',form.elements.at.value,form.dataset.due);}));}
  async function resolveTask(id,action,value,expectedDueAt){try{const nextFollowUpAt=value?new Date(`${value}:00+03:00`).toISOString():undefined;const payload={expectedDueAt,...(nextFollowUpAt?{nextFollowUpAt}:{})};const response=await fetch(`/api/pipeline/leads/${encodeURIComponent(id)}/follow-up/${action}`,{method:'POST',headers:{Authorization:`Bearer ${token()}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});const body=await response.json().catch(()=>({}));if(!response.ok||!body.success)throw new Error(body.message||'Could not update follow-up.');window.salemaxPipelineToast?.(action==='complete'?t('taskCompleted'):t('taskRescheduled'));await loadFollowUps();}catch(error){window.salemaxPipelineToast?.(error.message||'Could not update follow-up.');}}
  $('#boardMode').addEventListener('click',()=>setView('board'));
  $('#listMode').addEventListener('click',()=>setView('list'));
})();
