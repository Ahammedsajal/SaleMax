'use strict';
function normalize(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}

const APPLE='https://apps.apple.com/qa/app/%D8%B9%D8%B1%D8%B6-%D9%88-%D8%B7%D9%84%D8%A8-%D9%82%D8%B7%D8%B1-talab-qtr/id6744091784';
const ANDROID='https://play.google.com/store/apps/details?id=com.talab.white';
function text(config,key,language,fallback){return config?.messages?.[key]?.[language]||fallback;}
function buttons(items){return items.slice(0,3).map(([id,title])=>({id,title}));}
function recruitmentReply({message,state,facts,config={}}){
 const language=/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(String(message||''))||state?.language==='ar'?'ar':'en';
 const input=normalize(String(message||''));const previous=state||{};let step=previous.step||'welcome',reply='',choices=[];
 const labels={talab:text(config,'buttonTalab',language,language==='ar'?'عن طلب':'About Talab'),salemax:text(config,'buttonSalemax',language,language==='ar'?'عن SaleMaX':'About SaleMaX'),role:text(config,'buttonRole',language,language==='ar'?'عن الوظيفة':'About the role'),commission:text(config,'buttonCommission',language,language==='ar'?'العمولة':'Commission'),apply:text(config,'buttonApply',language,language==='ar'?'قدّم الآن':'Apply now'),menu:text(config,'buttonMenu',language,language==='ar'?'القائمة':'Main menu'),human:text(config,'buttonHuman',language==='ar'?'تحدث مع المالك':'Talk to owner')};
 const match=(key,...terms)=>terms.some(term=>input===normalize(term)||input.includes(normalize(term)));
 if(match('menu','menu','main menu','main_menu','القائمة','الرئيسية','start over'))step='welcome';
 if(match('talab','about talab','about_talab','طلب','talab'))step='talab';
 else if(match('salemax','about salemax','about_salemax','salemax','سالمكس'))step='salemax';
 else if(match('commission','commission details','commission_details','commission only','العمولة','الراتب','عمولة'))step='commission';
 else if(match('apply','apply now','apply_now','application','ابدأ التقديم','قدم الآن','قدّم الآن'))step='apply';
 else if(match('role','about the role','about_role','job','الوظيفة','الدور','العمل'))step='role';
 else if(match('human','owner','talk to owner','talk_to_owner','موظف','المالك','تحدث مع المالك'))step='human';
 if(step==='welcome'){
  const base=text(config,'welcome',language,language==='ar'?'مرحباً بك!':'Hello and welcome!');
  const company=`${language==='ar'?'نحن':'We are'} Sitta Arbaa Sitta for Software Solutions (${language==='ar'?'السجل التجاري':'CR'} 251489), ${language==='ar'?'شركة برمجيات وتسويق مقرها قطر. طلب هو سوقنا الإلكتروني في قطر':'a Qatar-based software and marketing company. Talab is our marketplace app for Qatar'}.`;
  const apps=`Talab · Apple: ${APPLE}\nGoogle Play: ${ANDROID}`;
  const salemax=language==='ar'?'SaleMaX هو برنامج CRM مخصص لإدارة الأعمال. أنت تتحدث مباشرةً مع مالك الشركة ومطوّر البرامج.':'SaleMaX is our CRM software for customised business management. You are speaking directly with the company owner and software developer.';
  reply=[base,company,apps,salemax,text(config,'menuPrompt',language,language==='ar'?'اختر موضوعاً للمتابعة:':'Choose what you would like to know next:')].join('\n\n');
  choices=buttons([['about_talab',labels.talab],['about_salemax',labels.salemax],['about_role',labels.role]]);
 }else if(step==='talab'){
  reply=language==='ar'?`طلب هو تطبيق سوق إلكتروني يساعد الناس والأعمال في قطر على عرض المنتجات والخدمات والعثور عليها.\nApple: ${APPLE}\nGoogle Play: ${ANDROID}`:`Talab is our marketplace app for people and businesses in Qatar to discover and list products and services.\nApple App Store: ${APPLE}\nGoogle Play: ${ANDROID}`;
  choices=buttons([['about_salemax',labels.salemax],['about_role',labels.role],['main_menu',labels.menu]]);
 }else if(step==='salemax'){
  reply=language==='ar'?'SaleMaX هو برنامج CRM مخصص لإدارة الأعمال، يشمل تنظيم العملاء والتواصل وأدوات المبيعات. البرنامج من تطوير مالك الشركة الذي ستعمل معه مباشرةً.':'SaleMaX is our CRM and customised business-management software. It helps businesses organise customer communication and sales work. It is developed by the company owner, whom you would work with directly.';
  choices=buttons([['about_role',labels.role],['about_talab',labels.talab],['main_menu',labels.menu]]);
 }else if(step==='role'){
  reply=language==='ar'?'الدور: مساعد مبيعات تقنية عن بُعد في الهند. نحن نوفر العملاء المحتملين. ستتواصل مع أصحاب الأعمال، تشرح SaleMaX، تقدم عروضاً عبر Google Meet وتساعد على إتمام الاشتراك السنوي. الإنجليزية بمستوى مهني مطلوب؛ الهندية مفيدة لكنها اختيارية.':'Role: Remote IT/SaaS Sales Associate based in India. We provide the leads. You will contact business owners, explain SaleMaX, give demos on Google Meet, and help close annual subscriptions. Professional English is required; Hindi is helpful but optional.';
  choices=buttons([['commission_details',labels.commission],['apply_now',labels.apply],['main_menu',labels.menu]]);
 }else if(step==='commission'){
  reply=language==='ar'?'خلال أول 2–3 أشهر توجد فترة تجربة بعمولة فقط دون راتب أساسي. العمولة 15% من الاشتراك السنوي المدفوع بقيمة 2,500 ريال قطري، أي 375 ريالاً لكل عملية بيع مدفوعة. بعد التجربة، قد يُنظر في تعيين بدوام كامل براتب أساسي وعمولة؛ ولا يُعد ذلك مضموناً.':'The first 2–3 months are a commission-only trial with no base salary. Commission is 15% of a paid QAR 2,500 annual subscription: QAR 375 per paid sale. After the trial, successful associates may be considered for full-time employment with a basic salary plus commission; this is not guaranteed.';
  choices=buttons([['apply_now',labels.apply],['about_role',labels.role],['main_menu',labels.menu]]);
 }else if(step==='apply'){
  const url=facts.find(item=>item.kind==='recruitment_application')?.url;
  if(!url){reply=language==='ar'?'نموذج التقديم غير متاح مؤقتاً. يرجى طلب مساعدة المالك.':'The application form is temporarily unavailable. Please ask to speak with the owner.';choices=buttons([['talk_to_owner',labels.human],['main_menu',labels.menu]]);step='human';}
  else{reply=language==='ar'?`أكمل طلبك وارفع سيرتك الذاتية من الرابط الآمن التالي:\n${url}\nسيُحفظ الطلب في قسم Applications & CVs الخاص بالتوظيف.`:`Complete your application and upload your CV through this secure form:\n${url}\nYour submission will be saved in the private Applications & CVs review area.`;choices=buttons([['about_role',labels.role],['main_menu',labels.menu]]);}
 }else{
  reply=language==='ar'?'سأطلب من مالك الشركة متابعة محادثتك. يمكنك أيضاً استكمال طلب التقديم من القائمة.':'I will ask the company owner to follow up in this chat. You can also continue your application from the menu.';
  choices=buttons([['apply_now',labels.apply],['main_menu',labels.menu]]);step='human';
 }
 return {reply,state:{...previous,language,step,greeted:true},buttons:choices};
}
module.exports={recruitmentReply};
