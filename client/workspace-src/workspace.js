const $ = selector => document.querySelector(selector);
let lang=localStorage.getItem('salemax-preview-language')==='ar'?'ar':'en';
let current, category='training_center', requestVersion=0;
const copy={
  preview:['DESIGN PREVIEW · Synthetic data · No production actions','معاينة التصميم · بيانات افتراضية · لا توجد إجراءات إنتاجية'],
  role:['Preview role','دور المعاينة'], workspace:['Workspace','مساحة العمل'], today:['Your business, at a glance','أعمالك في لمحة'],
  agentToday:['Your next conversations','محادثاتك التالية'], financeToday:['Your collections workday','يوم عمل التحصيل'], platformToday:['Keep every business moving','متابعة سير العمل لكل مؤسسة'],
  introduction:['One place for your leads, your team and the next action.','مكان واحد للعملاء المحتملين وفريقك والإجراء التالي.'], platformIntro:['Manage accounts, plans and operational exceptions from one workspace.','إدارة الحسابات والخطط والاستثناءات التشغيلية من مساحة واحدة.'],
  platform:['SALEMAX OPERATIONS','إدارة SALEMAX'], training:['TRAINING CENTER','مركز تدريب'], fixture:['CATEGORY CONTRACT FIXTURE','نموذج عقد الفئة'],
  business:['Doha Skills Center · Demo','مركز مهارات الدوحة · عرض تجريبي'], overview:['Dashboard','لوحة التحكم'],
  visibleLeads:['Visible leads','العملاء المحتملون المرئيون'], attention:['Need attention','بحاجة إلى اهتمام'], available:['Role navigation items','عناصر التنقل للدور'], sample:['Illustrative records only','سجلات توضيحية فقط'], roleFiltered:['Filtered by this role','مصفاة حسب هذا الدور'],
  queue:['Today’s work queue','قائمة مهام اليوم'], checkTitle:['Access checks','فحوص الصلاحيات'], learner:['Learner / course','المتعلم / الدورة'], outcome:['Outcome / next action','النتيجة / الإجراء التالي'], action:['Action','الإجراء'],
  inspect:['Inspect','فحص'], search:['Find a learner or course','ابحث عن متعلم أو دورة'], empty:['No matching leads in this role’s permitted scope.','لا يوجد عملاء محتملون مطابقون ضمن نطاق هذا الدور.'], allowed:['Allowed','مسموح'], denied:['Denied','مرفوض'],
  channels:['Channels need setup','القنوات بحاجة إلى إعداد'], channelNote:['WhatsApp and email are disconnected in this prototype. A delivery success cannot be inferred from sample data.','واتساب والبريد الإلكتروني غير متصلين في هذا النموذج. لا تعني البيانات الافتراضية نجاح التسليم.'],
  categoryTitle:['A workspace shaped for your business','مساحة عمل مصممة لنشاطك'], categoryNote:['Change the test category to verify that training features disappear.','غيّر فئة الاختبار للتحقق من اختفاء ميزات التدريب.'], category:['Test category','فئة الاختبار'],
  footer:['TC01 prototype · Uses the backend category and permission policy · Business workflows are still being implemented','نموذج TC01 · يستخدم سياسة الفئات والصلاحيات في الخادم · سير عمل الأعمال قيد التنفيذ'],
  sidebarNote:['Navigation follows category, plan and role. Direct API calls must pass the same checks.','يعتمد التنقل على الفئة والخطة والدور. يجب أن تجتاز طلبات API المباشرة الفحوص نفسها.'],
  loading:['Loading your role preview…','جارٍ تحميل معاينة الدور…'], error:['Unable to load the preview. Retry by changing the role.','تعذّر تحميل المعاينة. أعد المحاولة بتغيير الدور.'],
  scope:['Record scope','نطاق السجلات'], permission:['Permission','الصلاحية'], capability:['Feature','الميزة'], readiness:['Workflow readiness','جاهزية سير العمل'], notImplemented:['Preview only; business workflow not enabled','معاينة فقط؛ سير عمل الأعمال غير مفعّل'],
  detail:['Lead preview','معاينة العميل المحتمل'], policyNote:['These results come from the actual backend policy. Role switching here uses synthetic fixtures and cannot grant access to a real account.','تأتي هذه النتائج من سياسة الخادم الفعلية. تغيير الدور هنا يستخدم بيانات افتراضية ولا يمنح الوصول إلى حساب حقيقي.'],
  businesses:['Businesses','الأعمال'], plans:['Plans requiring attention','خطط بحاجة إلى اهتمام'], audit:['Audited authority','صلاحيات مسجلة'],
  platformQueue:['Operations priorities','أولويات العمليات'], platformRows:[['Demo center · Published plan assignment','مركز تجريبي · تعيين خطة منشورة'],['Demo account · Onboarding review','حساب تجريبي · مراجعة الانضمام'],['Demo channel · Connection setup pending','قناة تجريبية · انتظار إعداد الاتصال']],
};
const roleNames={super_admin:['Super Admin','المشرف العام'],staff:['SaleMaX Staff','موظف SaleMaX'],owner:['Business Owner','مالك المؤسسة'],accountant:['Accountant','محاسب'],manager:['Manager','مدير'],agent:['Agent','وكيل']};
const scopes={tenant:['Business-wide','المؤسسة بأكملها'],assigned:['Assigned records','السجلات المعينة'],own:['Own performance','الأداء الشخصي'],billing:['Billing-related','متعلق بالفوترة'],summary:['Summary only','ملخص فقط'],finance:['Finance only','المالية فقط'],sales:['Team sales','مبيعات الفريق'],platform:['Platform delegation','تفويض المنصة']};
const txt=key=>copy[key][lang==='ar'?1:0];
const local=value=>value?.[lang]||'';
function node(tag,attributes={},children=[]) {
  const element=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)) {
    if(key==='class')element.className=value;
    else if(key==='text')element.textContent=value;
    else if(key.startsWith('on'))element.addEventListener(key.slice(2),value);
    else element.setAttribute(key,value);
  }
  for(const child of children)element.append(typeof child==='string'?document.createTextNode(child):child);
  return element;
}
function icon(key) {return ['courses','batches','enrollments'].includes(key)?'▤':['inbox','whatsapp-qr','whatsapp-meta'].includes(key)?'◌':['payments','invoices','installments','receipts','credits'].includes(key)?'▥':['reports','scheduled-reports'].includes(key)?'▦':key==='dashboard'?'⊞':'◇';}
function openDialog(title,children) {
  $('#access-title').textContent=title;
  $('#access-body').replaceChildren(...children);
  $('#access-dialog').showModal();
}
async function inspect(item) {
  const role=current.role, selectedCategory=category;
  try {
    const response=await fetch('/api/preview/inspect?'+new URLSearchParams({role,category:selectedCategory,key:item.key}));
    if(!response.ok)throw new Error();
    const result=await response.json();
    if(current.role!==role||category!==selectedCategory)return;
    const definitions=node('dl',{class:'definition'});
    for(const [key,value] of [['scope',scopes[result.scope]?.[lang==='ar'?1:0]||result.scope||'—'],['permission',result.permission||'—'],['capability',result.capability||'—'],['readiness',txt('notImplemented')]])definitions.append(node('dt',{text:txt(key)}),node('dd',{text:value}));
    openDialog(local(item.label),[definitions,node('p',{class:'notice',text:txt('policyNote')})]);
  }catch{openDialog(local(item.label),[node('p',{text:txt('error')})]);}
}
function details(lead) {
  openDialog(txt('detail'),[node('h3',{text:local(lead.name)}),node('p',{text:local(lead.course)}),node('p',{text:local(lead.outcome)}),node('p',{class:'notice',text:txt('policyNote')})]);
}
function renderQueue(search='') {
  const body=$('#queue-body');if(!body)return;
  const value=search.toLocaleLowerCase();
  const leads=current.leads.filter(lead=>(local(lead.name)+' '+local(lead.course)).toLocaleLowerCase().includes(value));
  body.replaceChildren();
  for(const lead of leads)body.append(node('tr',{},[
    node('td',{},[node('strong',{text:local(lead.name)}),node('span',{class:'subtle',text:local(lead.course)})]),
    node('td',{},[node('span',{class:'pill',text:local(lead.stage)}),node('div',{class:'subtle',text:local(lead.outcome)})]),
    node('td',{},[node('button',{class:'detail-btn',text:txt('inspect'),onclick:()=>details(lead),'aria-label':txt('inspect')+' '+local(lead.name)})]),
  ]));
  $('#queue-empty').hidden=leads.length>0;
}
function render() {
  document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
  $('#preview-banner').textContent=txt('preview');$('#role-label').textContent=txt('role');$('#language').textContent=lang==='ar'?'English':'العربية';
  $('#sidebar-note').textContent=txt('sidebarNote');$('#footer').textContent=txt('footer');$('#loading').textContent=txt('loading');
  $('#close-dialog').setAttribute('aria-label',lang==='ar'?'إغلاق':'Close');$('#menu-toggle').setAttribute('aria-label',lang==='ar'?'فتح التنقل':'Open navigation');
  $('#menu-close').setAttribute('aria-label',lang==='ar'?'إغلاق التنقل':'Close navigation');
  for(const option of $('#role-select').options)option.textContent=roleNames[option.value][lang==='ar'?1:0];
  const platform=current.audience==='platform';
  $('#business-name').replaceChildren(node('span',{text:platform?'SaleMaX':txt('business')}),node('small',{text:platform?txt('platform'):local(current.category.title)}));
  $('#breadcrumb').replaceChildren(node('span',{text:txt('workspace')+' / '}),node('b',{text:txt('overview')}));
  const nav=$('#navigation');nav.replaceChildren();let group='';
  for(const item of current.nav){const nextGroup=local(item.group);if(nextGroup!==group){group=nextGroup;nav.append(node('div',{class:'group-label',text:group}));}nav.append(node('button',{class:item.key==='dashboard'?'active':'','data-nav':item.key,onclick:()=>{if(item.key==='dashboard'){$('#content').focus();document.body.classList.remove('menu-open');}else inspect(item);}},[node('span',{class:'nav-icon','aria-hidden':'true',text:icon(item.key)}),local(item.label)]));}
  const title=platform?'platformToday':current.role==='agent'?'agentToday':current.role==='accountant'?'financeToday':'today';
  const intro=node('section',{class:'intro'},[node('div',{},[node('div',{class:'eyebrow',text:platform?txt('platform'):category==='restaurant_fixture'?txt('fixture'):txt('training')}),node('h1',{text:txt(title)}),node('p',{text:txt(platform?'platformIntro':'introduction')})]),node('span',{class:'role-chip',text:roleNames[current.role][lang==='ar'?1:0]})]);
  const stats=node('section',{class:'stats','aria-label':txt('overview')});
  const values=platform?[['businesses',2],['plans',1],['available',current.nav.length]]:[['visibleLeads',current.leads.length],['attention',current.leads.filter(l=>l.attention).length],['available',current.nav.length]];
  for(const [key,value] of values)stats.append(node('div',{class:'stat'},[node('div',{class:'stat-label',text:txt(key)}),node('div',{class:'stat-number',text:new Intl.NumberFormat(lang==='ar'?'ar-QA':'en-QA').format(value)}),node('div',{class:'stat-note',text:txt(platform?'sample':'roleFiltered')})]));
  const queue=node('section',{class:'panel'},[node('div',{class:'panel-head'},[node('h2',{text:txt(platform?'platformQueue':'queue')}),node('span',{class:'subtle',text:txt('sample')})])]);
  if(platform)for(const row of copy.platformRows)queue.append(node('div',{class:'check-row'},[node('span',{text:row[lang==='ar'?1:0]}),node('span',{class:'status denied',text:txt('sample')})]));
  else {
    const search=node('input',{type:'search',placeholder:txt('search'),'aria-label':txt('search'),oninput:event=>renderQueue(event.target.value)});
    queue.append(node('div',{class:'filters'},[search]),node('div',{class:'table-wrap'},[node('table',{},[node('thead',{},[node('tr',{},['learner','outcome','action'].map(key=>node('th',{scope:'col',text:txt(key)})))]),node('tbody',{id:'queue-body'})])]),node('div',{id:'queue-empty',class:'empty',text:txt('empty')}));
  }
  const checks=node('section',{class:'panel'},[node('div',{class:'panel-head'},[node('h2',{text:txt('checkTitle')})])]);
  for(const check of current.checks)checks.append(node('div',{class:'check-row'},[node('span',{text:local(check.label)}),node('span',{class:'status '+(check.allowed?'allowed':'denied'),text:txt(check.allowed?'allowed':'denied'),'data-check':check.key})]));
  checks.append(node('div',{class:'readiness'},[node('strong',{text:txt('channels')}),node('span',{text:txt('channelNote')})]));
  const categorySelect=node('select',{id:'category-select',onchange:event=>{category=event.target.value;load();}},[node('option',{value:'training_center',text:lang==='ar'?'مركز تدريب':'Training center'}),node('option',{value:'restaurant_fixture',text:lang==='ar'?'نموذج مطعم للاختبار':'Restaurant test fixture'})]);categorySelect.value=category;
  const bottom=node('section',{class:'bottom-panel'},[node('div',{},[node('h2',{text:txt('categoryTitle')}),node('p',{text:txt('categoryNote')})]),node('div',{class:'category-control'},[node('label',{for:'category-select',text:txt('category')}),categorySelect])]);
  $('#view').replaceChildren(intro,stats,node('div',{class:'panels'},[queue,checks]),bottom);
  renderQueue();
}
async function load() {
  const version=++requestVersion;$('#loading').hidden=false;$('#loading').textContent=txt('loading');$('#error').hidden=true;
  try{const response=await fetch('/api/preview/context?'+new URLSearchParams({role:$('#role-select').value,category}));if(!response.ok)throw new Error();const result=await response.json();if(version!==requestVersion)return;current=result;render();}
  catch{if(version===requestVersion){$('#view').replaceChildren();$('#navigation').replaceChildren();$('#error').textContent=txt('error');$('#error').hidden=false;}}
  finally{if(version===requestVersion)$('#loading').hidden=true;}
}
$('#role-select').addEventListener('change',()=>{$('#access-dialog').close();load();});
$('#language').addEventListener('click',()=>{lang=lang==='en'?'ar':'en';localStorage.setItem('salemax-preview-language',lang);$('#access-dialog').close();if(current)render();});
$('#close-dialog').addEventListener('click',()=>$('#access-dialog').close());
function closeMenu() {
  document.body.classList.remove('menu-open');
  $('.workspace').inert=false;
  $('#menu-toggle').setAttribute('aria-expanded','false');
}
$('#menu-toggle').addEventListener('click',()=>{
  document.body.classList.add('menu-open');
  $('.workspace').inert=true;
  $('#menu-toggle').setAttribute('aria-expanded','true');
  $('#menu-close').focus();
});
$('#menu-close').addEventListener('click',()=>{closeMenu();$('#menu-toggle').focus();});
$('#navigation').addEventListener('click',()=>closeMenu(),true);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.body.classList.contains('menu-open')){closeMenu();$('#menu-toggle').focus();}
  if(event.key==='Tab'&&document.body.classList.contains('menu-open')) {
    const buttons=Array.from($('#sidebar').querySelectorAll('button'));
    const first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
matchMedia('(max-width:700px)').addEventListener('change',()=>closeMenu());
load();
