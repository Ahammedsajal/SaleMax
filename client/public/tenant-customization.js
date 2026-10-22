(() => {
  'use strict';
  const tr=(en,ar)=>document.documentElement.lang?.toLowerCase().startsWith('ar')?ar:en;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request=(path='',method='GET',body)=>window.SaleMaxWorkspace.request('customization',path,{method,body}).then(result=>result.data);
  const messages={
    PERMISSION_DENIED:['Only the business owner can publish customization.','مالك النشاط فقط يمكنه نشر التخصيص.'],
    STALE_CUSTOMIZATION_REVISION:['Another change was saved. Reload this section before editing again.','تم حفظ تغيير آخر. أعد تحميل هذا القسم قبل التعديل.'],
    CUSTOMIZATION_VERSION_MISMATCH:['This configuration needs a reviewed category upgrade. Contact the platform team.','تحتاج هذه الإعدادات إلى ترقية معتمدة للفئة. تواصل مع فريق المنصة.'],
    INVALID_CUSTOMIZATION_LABEL:['Enter both English and Arabic labels, up to 80 characters each.','أدخل الاسمين بالإنجليزية والعربية، بحد أقصى 80 حرفًا لكل اسم.'],
    INVALID_LEAD_FIELD:['Check the field definitions. Each field needs a type and both labels.','تحقق من تعريفات الحقول. يحتاج كل حقل إلى نوع واسميه.'],
    INVALID_LEAD_FIELD_LABEL:['Enter the English and Arabic field labels.','أدخل اسم الحقل بالإنجليزية والعربية.'],
    CUSTOMIZATION_RATE_LIMITED:['Too many changes. Try again later.','تغييرات كثيرة. حاول لاحقًا.'],
    INVALID_CUSTOMIZATION_TASK_TYPES:['Choose only task types available for your business category.','اختر أنواع المهام المتاحة لفئة نشاطك فقط.'],
  };
  async function mount(host){
    if(!host?.isConnected||host.querySelector('[data-sx-customization]')||!window.SaleMaxWorkspace)return;
    const panel=document.createElement('section');panel.className='card';panel.dataset.sxCustomization='1';host.querySelector('.wrap')?.append(panel);
    let state,busy=false,dirty=false;
    const announce=(text,error=false)=>{const node=panel.querySelector('[data-message]');if(node){node.textContent=text;node.setAttribute('role',error?'alert':'status');}};
    const error=err=>announce(messages[err.message]?tr(...messages[err.message]):tr('Customization is unavailable. Your current settings have not changed.','التخصيص غير متاح. لم تتغير إعداداتك الحالية.'),true);
    const controls=()=>panel.querySelectorAll('button,input,select');
    const setBusy=value=>{busy=value;controls().forEach(node=>node.disabled=value);if(!value){const publish=panel.querySelector('[data-publish]');if(publish)publish.disabled=dirty||!state?.draft;}};
    async function act(fn){if(busy)return;setBusy(true);try{await fn();}catch(err){error(err);}finally{setBusy(false);}}
    function collect(){
      const navigationLabels={};
      for(const field of state.fields){
        const row=panel.querySelector(`[data-label-key="${field.key}"]`),en=row.querySelector('[data-en]').value.trim(),ar=row.querySelector('[data-ar]').value.trim();
        if(!en&&!ar)continue;
        if(!en||!ar)throw Error('INVALID_CUSTOMIZATION_LABEL');
        navigationLabels[field.key]={en,ar};
      }
      const hiddenNavigation=[...panel.querySelectorAll('[data-hide-navigation]:checked')].map(input=>input.value);
      const enabledTaskTypes=panel.querySelector('[data-task-types-defaults]')?.checked?null:[...panel.querySelectorAll('[data-task-type]:checked:not(:disabled)')].map(input=>input.value);
      return {schemaVersion:4,navigationLabels,leadFields:window.SaleMaxLeadFieldEditor?.collect(panel)||[],hiddenNavigation,enabledTaskTypes};
    }
    async function load(notice=''){
      const data=await request();if(!panel.isConnected)return;state=data;dirty=false;
      const document=state.draft?.document||state.active?.document||state.defaults;
      panel.innerHTML=`<h2>${tr('Customize your workspace','تخصيص مساحة عملك')}</h2><p>${tr('Rename menu items for your business and team. Save and preview a draft before publishing. Other businesses keep their own settings.','غيّر أسماء عناصر القائمة لنشاطك وفريقك. احفظ المسودة وعاينها قبل النشر. تحتفظ الأنشطة الأخرى بإعداداتها الخاصة.')}</p><p>${tr('Published configuration','الإعداد المنشور')}: ${state.active?esc(state.active.id.slice(0,8)):tr('Category defaults','إعدادات الفئة الافتراضية')}</p><p data-message role="status"></p><form><details><summary>${tr('English and Arabic menu labels','أسماء القائمة بالإنجليزية والعربية')}</summary><p>${tr('Leave both boxes empty to use the category default. Labels do not change permissions.','اترك الحقلين فارغين لاستخدام اسم الفئة الافتراضي. لا تغيّر الأسماء الصلاحيات.')}</p>${state.fields.map(field=>{const label=document.navigationLabels[field.key];return `<fieldset data-label-key="${esc(field.key)}" style="border:1px solid #e4e8ef;border-radius:9px;margin:12px 0;padding:12px"><legend>${esc(tr(field.label.en,field.label.ar))}</legend><label>${tr('English','الإنجليزية')}<input data-en lang="en" dir="ltr" maxlength="80" placeholder="${esc(field.label.en)}" value="${esc(label?.en||'')}"></label><label>${tr('Arabic','العربية')}<input data-ar lang="ar" dir="rtl" maxlength="80" placeholder="${esc(field.label.ar)}" value="${esc(label?.ar||'')}"></label></fieldset>`;}).join('')}</details><div class="actions"><button type="button" data-preview>${tr('Preview changes','معاينة التغييرات')}</button><button type="submit">${tr('Save draft','حفظ المسودة')}</button><button type="button" data-defaults>${tr('Use category defaults','استخدام إعدادات الفئة الافتراضية')}</button></div></form><div data-preview-result></div><div class="actions"><button type="button" data-publish class="primary" ${state.draft?'':'disabled'}>${tr('Publish saved draft','نشر المسودة المحفوظة')}</button><button type="button" data-reload>${tr('Reload settings','إعادة تحميل الإعدادات')}</button></div>${state.history.length?`<label>${tr('Published history','الإصدارات المنشورة')}<select data-history>${state.history.map(row=>`<option value="${esc(row.id)}">v${esc(row.revision)} · ${esc(new Date(row.createdAt).toLocaleString())}</option>`).join('')}</select></label><button type="button" data-restore>${tr('Restore selected version','استعادة الإصدار المحدد')}</button>`:''}`;
      const hideMenu=window.document.createElement('details');hideMenu.innerHTML=`<summary>${tr('Hide menu sections','إخفاء أقسام القائمة')}</summary><p>${tr('This changes menus for your business only. It does not change plan access or permissions.','يغيّر هذا القوائم لنشاطك فقط. ولا يغيّر صلاحيات الباقة أو أذونات المستخدمين.')}</p>${state.fields.map(field=>`<label style="display:flex;gap:9px;align-items:center;margin:10px 0"><input type="checkbox" data-hide-navigation value="${esc(field.key)}" ${(document.hiddenNavigation||[]).includes(field.key)?'checked':''}>${esc(tr(field.label.en,field.label.ar))}</label>`).join('')}`;
      panel.querySelector('form').prepend(hideMenu);
      const taskTypes=window.document.createElement('details');taskTypes.innerHTML=`<summary>${tr('Choose task types for your business','اختر أنواع المهام لنشاطك')}</summary><p>${tr('This only changes task choices for your business. Category and plan access still apply. Existing tasks remain in history.','يغيّر هذا خيارات المهام لنشاطك فقط. تظل الفئة والباقة محددتين للصلاحيات، وتبقى المهام الحالية محفوظة.')}</p><label style="display:flex;gap:9px;align-items:center;margin:10px 0"><input type="checkbox" data-task-types-defaults ${document.enabledTaskTypes==null?'checked':''}>${tr('Follow category defaults','استخدام أنواع المهام الافتراضية للفئة')}</label>${(state.taskTypes||[]).map(item=>`<label style="display:flex;gap:9px;align-items:center;margin:10px 0"><input type="checkbox" data-task-type data-plan-available="${item.planAvailable?'true':'false'}" value="${esc(item.key)}" ${(document.enabledTaskTypes==null||document.enabledTaskTypes.includes(item.key))?'checked':''} ${item.planAvailable&&document.enabledTaskTypes!=null?'':'disabled'}>${esc(tr(item.label.en,item.label.ar))}${item.planAvailable?'':` · ${tr('Not included in your plan','غير متاح في باقتك')}`}</label>`).join('')||`<p>${tr('No additional task types are available for this category.','لا توجد أنواع مهام إضافية متاحة لهذه الفئة.')}</p>`}`;
      panel.querySelector('form').prepend(taskTypes);
      taskTypes.querySelector('[data-task-types-defaults]').onchange=event=>taskTypes.querySelectorAll('[data-task-type]').forEach(input=>input.disabled=event.currentTarget.checked||input.dataset.planAvailable!=='true');
      window.SaleMaxLeadFieldEditor?.mount(panel,document.leadFields||[]);
      announce(notice||tr('Changes stay in the draft until you publish.','تبقى التغييرات في المسودة حتى تنشرها.'));
      const markDirty=()=>{dirty=true;panel.querySelector('[data-publish]').disabled=true;announce(tr('Save this draft before publishing.','احفظ هذه المسودة قبل نشرها.'));};
      panel.querySelector('form').oninput=markDirty;
      panel.querySelector('form').onsubmit=event=>{event.preventDefault();act(async()=>{await request('/draft','PUT',{expectedRevision:state.revision,document:collect()});await load(tr('Draft saved. Review and publish when ready.','تم حفظ المسودة. راجعها وانشرها عندما تكون جاهزًا.'));});};
      panel.querySelector('[data-preview]').onclick=()=>act(async()=>{const result=await request('/preview','POST',{document:collect()}),rows=Object.entries(result.document.navigationLabels),hidden=(result.document.hiddenNavigation||[]).map(key=>state.fields.find(field=>field.key===key)).filter(Boolean);panel.querySelector('[data-preview-result]').innerHTML=`<h3>${tr('Draft preview','معاينة المسودة')}</h3>${rows.length?`<ul>${rows.map(([key,value])=>`<li>${esc(state.fields.find(field=>field.key===key)?.label.en||key)}: ${esc(value.en)} · <span lang="ar" dir="rtl">${esc(value.ar)}</span></li>`).join('')}</ul>`:`<p>${tr('No custom menu labels.','لا توجد أسماء قائمة مخصصة.')}</p>`}<p data-hidden-preview>${hidden.length?`${tr('Menu sections to hide','أقسام القائمة التي سيتم إخفاؤها')}: ${hidden.map(field=>esc(tr(field.label.en,field.label.ar))).join(', ')}`:tr('No menu sections are hidden.','لا توجد أقسام قائمة مخفية.')}</p><p>${tr('Custom lead fields','حقول العملاء المخصصة')}: ${(result.document.leadFields||[]).filter(field=>field.active).length}</p>`;window.SaleMaxLeadFieldEditor?.preview(panel.querySelector('[data-preview-result]'),result.document.leadFields||[]);});
      panel.querySelector('[data-defaults]').onclick=()=>{window.SaleMaxLeadFieldEditor?.reset(panel);panel.querySelectorAll('[data-en],[data-ar]').forEach(input=>input.value='');panel.querySelectorAll('[data-hide-navigation]').forEach(input=>input.checked=false);const taskDefaults=panel.querySelector('[data-task-types-defaults]');if(taskDefaults){taskDefaults.checked=true;taskDefaults.dispatchEvent(new Event('change',{bubbles:true}));}panel.querySelectorAll('[data-task-type]').forEach(input=>{input.checked=true;});markDirty();};
      const published=async notice=>{window.SaleMaxWorkspace.invalidateSession?.();window.dispatchEvent(new Event('salemax:customization-published'));await load(notice);};
      panel.querySelector('[data-publish]').onclick=()=>act(async()=>{if(dirty)return;await request('/publish','POST',{expectedRevision:state.revision});await published(tr('Published for your business and team.','تم النشر لنشاطك وفريقك.'));});
      panel.querySelector('[data-reload]').onclick=()=>act(()=>load());
      panel.querySelector('[data-restore]')?.addEventListener('click',()=>act(async()=>{await request('/rollback','POST',{expectedRevision:state.revision,targetId:panel.querySelector('[data-history]').value});await published(tr('The selected configuration has been restored.','تمت استعادة الإعدادات المحددة.'));}));
    }
    panel.innerHTML=`<h2>${tr('Customize your workspace','تخصيص مساحة عملك')}</h2><p data-message role="status">${tr('Loading…','جارٍ التحميل…')}</p>`;
    try{await load();}catch(err){error(err);}
  }
  window.SaleMaxCustomization=Object.freeze({mount});
})();
