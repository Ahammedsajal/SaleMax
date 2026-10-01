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
      note:'Internal note', contactOutcome:'Contact outcome', followUpRequired:'Follow-up required', noFollowUp:'No follow-up required', previous:'Previous', next:'Next', page:'Page', of:'of',
      outcomesMap:{no_answer:'No answer',connected:'Connected',interested:'Interested',not_interested:'Not interested',follow_up_scheduled:'Follow-up scheduled',wrong_number:'Wrong number',requested_call:'Call requested',sale_requested:'Sale requested'}
    },
    ar: {
      title:'تقارير النشاط', subtitle:'سجل واضح لمسؤولية العملاء والنتائج والمتابعة التالية.',
      ownerScope:'نشاط مساحة العمل بالكامل', agentScope:'العملاء المسندون إليك حاليًا فقط', period:'الفترة', daily:'يومي', weekly:'أسبوعي', monthly:'شهري',
      date:'تاريخ التقرير', apply:'عرض التقرير', loading:'جارٍ إعداد التقرير…', empty:'لم تُسجل ملاحظات أو نتائج للعملاء خلال هذه الفترة.',
      failed:'تعذر تحميل التقرير. لم تتغير بياناتك.', retry:'إعادة المحاولة', created:'عملاء جدد', touched:'عملاء تمت متابعتهم', outcomes:'نتائج التواصل', notes:'ملاحظات مضافة',
      followUpsRequired:'متابعات مطلوبة', followUpsDue:'متابعات مستحقة خلال الفترة', overdue:'متابعات مفتوحة متأخرة الآن', outcomeBreakdown:'تفصيل النتائج',
      occurred:'الوقت', lead:'العميل / جهة الاتصال', attended:'تمت المتابعة بواسطة', activity:'النشاط', details:'النتيجة أو الملاحظة', followUp:'المتابعة التالية',
      exportPage:'تصدير هذه الصفحة (CSV)', exportReady:'تم تنزيل صفحة التقرير بصيغة CSV.',
      note:'ملاحظة داخلية', contactOutcome:'نتيجة التواصل', followUpRequired:'المتابعة مطلوبة', noFollowUp:'لا توجد متابعة مطلوبة', previous:'السابق', next:'التالي', page:'صفحة', of:'من',
      outcomesMap:{no_answer:'لا يوجد رد',connected:'تم التواصل',interested:'مهتم',not_interested:'غير مهتم',follow_up_scheduled:'تم تحديد متابعة',wrong_number:'رقم خاطئ',requested_call:'طلب اتصال',sale_requested:'طلب الشراء'}
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
  const state = {page:1,report:null,sequence:0,period:'daily',at:qatarToday()};
  const host = $('#reports'), toolbar = $('.toolbar');
  if (!host || !$('#reportsMode')) return;

  function setView(view) {
    const reports = view === 'reports';
    $('#summary').classList.toggle('hidden',reports);
    $('#board').classList.toggle('hidden',reports || view !== 'board');
    $('#list').classList.toggle('hidden',reports || view !== 'list');
    host.classList.toggle('hidden',!reports);
    toolbar.classList.toggle('report-mode',reports);
    for (const [id,active] of [['boardMode',view==='board'],['listMode',view==='list'],['reportsMode',reports]]) {
      const button=$('#'+id);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    }
    if(reports && !state.report) load();
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
    const listHtml=report.total?`<div class="report-table-wrap"><table class="report-table"><thead><tr><th>${t('occurred')}</th><th>${t('lead')}</th><th>${t('attended')}</th><th>${t('activity')}</th><th>${t('details')}</th><th>${t('followUp')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <nav class="report-pagination" aria-label="Report pages"><button type="button" id="reportPrevious" ${report.page<=1?'disabled':''}>${t('previous')}</button><span>${t('page')} ${escape(report.page)} · ${report.total} ${t('of')} ${Math.max(1,Math.ceil(report.total/report.limit))}</span><button type="button" id="reportNext" ${report.hasMore?'':'disabled'}>${t('next')}</button></nav>`:`<div class="report-state">${t('empty')}</div>`;
    host.innerHTML=shell(`<p class="report-period">${escape(periodText)} · ${escape(report.timezone||'Asia/Qatar')}</p><div class="report-kpis">${metrics.map(([key,value])=>metric(t(key),Number(value||0).toLocaleString(arabic()?'ar-QA':'en-QA'))).join('')}</div>${outcomeHtml}${listHtml}`);
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
  window.salemaxPipelineReports={load,setView};
})();
