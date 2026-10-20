'use strict';
function normalize(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}

const APPLE='https://apps.apple.com/qa/app/%D8%B9%D8%B1%D8%B6-%D9%88-%D8%B7%D9%84%D8%A8-%D9%82%D8%B7%D8%B1-talab-qtr/id6744091784';
const ANDROID='https://play.google.com/store/apps/details?id=com.talab.white';
function text(config,key,language,fallback){return config?.messages?.[key]?.[language]||fallback;}
function buttons(items){return items.slice(0,3).map(([id,title])=>({id,title}));}
const SCREENING={
 screen_consent:{
  question:{en:'Before we start, may we save your answers in our private Applications & CVs area so the SaleMaX team can review your application and contact you? You can send your CV now or later.',ar:'قبل أن نبدأ، هل تسمح بحفظ إجاباتك في قسم الطلبات والسير الذاتية الخاص ليتمكن فريق SaleMaX من مراجعة طلبك والتواصل معك؟ يمكنك إرسال سيرتك الذاتية الآن أو لاحقاً.'},
  options:[['screen_consent_yes',{en:'Agree and continue',ar:'أوافق وأتابع'},'yes'],['screen_consent_no',{en:'No, thanks',ar:'لا، شكراً'},'no']]
 },
 screen_working:{question:{en:'Are you currently working?',ar:'هل تعمل حالياً؟'},options:[['screen_working_yes',{en:'Yes',ar:'نعم'},'yes'],['screen_working_no',{en:'No',ar:'لا'},'no']]},
 screen_phone_same:{question:{en:'Is your contact number the same as this WhatsApp number?',ar:'هل رقم التواصل هو نفسه رقم واتساب هذا؟'},options:[['screen_phone_same_yes',{en:'Yes, same number',ar:'نعم، الرقم نفسه'},'same'],['screen_phone_same_no',{en:'No, another number',ar:'لا، رقم آخر'},'other']]},
 screen_english:{
  question:{en:'How would you rate your professional English?',ar:'كيف تقيّم مستواك المهني في الإنجليزية؟'},
  options:[['screen_english_professional',{en:'Professional',ar:'مهني'},'proficient'],['screen_english_intermediate',{en:'Intermediate',ar:'متوسط'},'intermediate'],['screen_english_basic',{en:'Basic',ar:'أساسي'},'basic']]
 },
 screen_hindi:{
  question:{en:'How comfortable are you speaking Hindi?',ar:'ما مستوى راحتك في التحدث بالهندية؟'},
  options:[['screen_hindi_fluent',{en:'Fluent',ar:'بطلاقة'},'fluent'],['screen_hindi_conversational',{en:'Conversational',ar:'محادثة'},'conversational'],['screen_hindi_none',{en:'None',ar:'لا أتحدثها'},'none']]
 },
 screen_total_experience:{question:{en:'How many years of total work experience do you have?',ar:'كم سنة من الخبرة العملية الإجمالية لديك؟'},options:[['screen_total_0',{en:'Less than 1 year',ar:'أقل من سنة'},'0'],['screen_total_1_2',{en:'1–2 years',ar:'١–٢ سنة'},'1-2'],['screen_total_3_plus',{en:'3 or more years',ar:'٣ سنوات أو أكثر'},'3+']]},
 screen_sales_experience:{question:{en:'How many years of sales experience do you have?',ar:'كم سنة من الخبرة في المبيعات لديك؟'},options:[['screen_sales_0',{en:'Less than 1 year',ar:'أقل من سنة'},'0'],['screen_sales_1_2',{en:'1–2 years',ar:'١–٢ سنة'},'1-2'],['screen_sales_3_plus',{en:'3 or more years',ar:'٣ سنوات أو أكثر'},'3+']]},
 screen_tools:{question:{en:'Do you have a computer or laptop and a reliable internet connection?',ar:'هل لديك كمبيوتر أو حاسوب محمول واتصال إنترنت موثوق؟'},options:[['screen_tools_yes',{en:'Yes, both',ar:'نعم، كلاهما'},'yes'],['screen_tools_no',{en:'No',ar:'لا'},'no']]},
 screen_calls:{question:{en:'Are you comfortable making sales calls through our system to leads we provide?',ar:'هل يناسبك إجراء مكالمات مبيعات عبر نظامنا مع العملاء الذين نوفرهم؟'},options:[['screen_calls_yes',{en:'Yes, comfortable',ar:'نعم، مناسب لي'},'yes'],['screen_calls_no',{en:'No',ar:'لا'},'no']]},
 screen_availability:{
  question:{en:'What work arrangement do you prefer?',ar:'ما نظام العمل الذي تفضله؟'},
  options:[['screen_availability_full',{en:'Full-time',ar:'دوام كامل'},'full_time'],['screen_availability_part',{en:'Part-time',ar:'دوام جزئي'},'part_time'],['screen_availability_either',{en:'Flexible',ar:'مرن'},'either']]
 }
};
const SCREENING_NEXT={screen_working:'screen_phone_same',screen_phone_same:'screen_email',screen_email:'screen_total_experience',screen_total_experience:'screen_sales_experience',screen_sales_experience:'screen_tools',screen_tools:'screen_calls',screen_calls:'screen_english',screen_english:'screen_hindi',screen_hindi:'screen_availability'};
const SCREENING_FIELDS={screen_working:'currentlyWorking',screen_phone_same:'contactNumberSame',screen_total_experience:'totalExperienceRange',screen_sales_experience:'salesExperienceYears',screen_tools:'hasComputerAndInternet',screen_calls:'comfortableWithSalesCalls',screen_english:'englishLevel',screen_hindi:'hindiLevel',screen_availability:'availability'};
function screeningQuestion(step,language){
 if(step==='screen_name')return {reply:language==='ar'?'ما اسمك الكامل؟':'What is your full name?',buttons:[]};
 if(step==='screen_email')return {reply:language==='ar'?'ما بريدك الإلكتروني؟':'What is your email address?',buttons:[]};
 if(step==='screen_contact_number')return {reply:language==='ar'?'ما رقم التواصل الآخر مع رمز الدولة؟':'What is your other contact number, including country code?',buttons:[]};
 const item=SCREENING[step];
 return {reply:item.question[language],buttons:buttons(item.options.map(([id,label])=>[id,label[language]]))};
}
function recruitmentReply({message,state,facts,config={}}){
 const language=/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(String(message||''))||state?.language==='ar'?'ar':'en';
 const input=normalize(String(message||''));const previous=state||{};let step=previous.step||'welcome',reply='',choices=[];
 const labels={talab:text(config,'buttonTalab',language,language==='ar'?'عن طلب':'About Talab'),salemax:text(config,'buttonSalemax',language,language==='ar'?'عن SaleMaX':'About SaleMaX'),role:text(config,'buttonRole',language,language==='ar'?'عن الوظيفة':'About the role'),commission:text(config,'buttonCommission',language,language==='ar'?'العمولة':'Commission details'),apply:text(config,'buttonApply',language,language==='ar'?'قدّم الآن':'Apply now'),menu:text(config,'buttonMenu',language,language==='ar'?'القائمة':'Main menu'),human:text(config,'buttonHuman',language,language==='ar'?'تحدث مع مسؤول التوظيف':'Talk to recruiter'),screening:text(config,'buttonScreening',language,language==='ar'?'قدّم الآن':'Apply now')};
 const match=(...terms)=>terms.some(term=>input===normalize(term)||input.includes(normalize(term)));
 const screeningStep=Object.hasOwn(SCREENING,step)||['screen_name','screen_email','screen_contact_number'].includes(step);
 let command=null;
 if(match('main_menu','main menu','القائمة','الرئيسية','start over',labels.menu))command='welcome';
 else if(match('about_talab','about talab','طلب','talab',labels.talab))command='talab';
 else if(match('about_salemax','about salemax','salemax','سالمكس',labels.salemax))command='salemax';
 else if(match('commission_details','commission details','commission only','pay and commission','pay commission','commission','pay','العمولة','الراتب','عمولة',labels.commission))command='commission';
 else if(match('continue_application','yes continue','continue','نعم أكمل'))command='continue_application';
 else if(match('apply_now','apply now','apply and upload cv','apply upload cv','application','apply','cv','resume','ابدأ التقديم','قدم الآن','قدّم الآن',labels.apply))command='apply';
 else if(match('start_screening','quick questions','screening','ابدأ الأسئلة','أسئلة سريعة'))command=previous.screeningConsent?'screen_name':'screen_consent';
 else if(match('about_role','about the role','role','requirements','job','الوظيفة','الدور','العمل',labels.role))command='role';
 else if(match('wait_for_recruiter','no i will wait','no thanks','انتظر مسؤول التوظيف'))command='wait_recruiter';
 else if(match('skip_cv','skip cv','no cv','تخطي السيرة الذاتية'))command='skip_cv';
 else if(match('talk_to_recruiter','talk to recruiter','talk to founder','founder','talk to owner','موظف','المؤسس','المالك','تحدث مع المالك',labels.human))command='human';
 if(command==='apply')step='apply';
 else if(command==='continue_application'){
  const question=screeningQuestion('screen_name',language);
  return {reply:question.reply,state:{...previous,language,step:'screen_name',screeningConsent:true,greeted:true,answers:{...(previous.answers||{}),whatsappNumber:previous.whatsappNumber||previous.answers?.whatsappNumber||''}},buttons:question.buttons};
 }
 else if(command==='skip_cv')step='application_saved';
 else if(command)step=command;
 else if(screeningStep&&['screen_name','screen_email','screen_contact_number'].includes(step)){
   const value=String(message||'').trim();
   if(step==='screen_email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return {reply:language==='ar'?'يرجى إدخال بريد إلكتروني صحيح.':'Please enter a valid email address.',state:previous,buttons:[]};
   if(!value||value.length>(step==='screen_name'?160:254))return {reply:screeningQuestion(step,language).reply,state:previous,buttons:[]};
   const key={screen_name:'fullName',screen_email:'email',screen_contact_number:'contactNumber'}[step];
   const answers={...(previous.answers||{}),[key]:value};
   const next=step==='screen_name'?'screen_working':step==='screen_email'?'screen_total_experience':'screen_email';
   const question=screeningQuestion(next,language);
   return {reply:question.reply,state:{...previous,language,step:next,answers},buttons:question.buttons};
  }
 else if(screeningStep){
  const option=SCREENING[step].options.find(([id,label,value])=>[id,label.en,label.ar,value].some(term=>input===normalize(term)));
  if(option){
   if(step==='screen_consent'){
    if(option[2]==='no')return {reply:language==='ar'?'حسنًا، لن نحفظ إجاباتك أو سيرتك الذاتية عبر واتساب. يمكنك مراجعة تفاصيل الوظيفة أو التحدث مع المؤسس.':'Understood. We will not save your answers or CV through WhatsApp. You can review the role or ask to speak with the Founder.',state:{...previous,language,step:'screening_declined',screeningConsent:false,answers:{}},buttons:buttons([['about_role',labels.role],['talk_to_founder',labels.human],['main_menu',labels.menu]])};
    const question=screeningQuestion('screen_name',language);
    return {reply:question.reply,state:{...previous,language,step:'screen_name',screeningConsent:true,greeted:true,answers:{whatsappNumber:previous.whatsappNumber||''}},buttons:question.buttons};
   }
   const answers={...(previous.answers||{}),[SCREENING_FIELDS[step]]:option[2]};
   const next=step==='screen_phone_same'&&option[2]==='other'?'screen_contact_number':SCREENING_NEXT[step];
   if(step==='screen_phone_same'&&option[2]==='same')answers.contactNumber=answers.whatsappNumber||'';
   if(next)step=next;
   else{
    step='awaiting_cv';
    return {reply:language==='ar'?'شكراً، تم حفظ إجاباتك. أرسل سيرتك الذاتية هنا كملف PDF أو DOCX (حتى 8 ميغابايت). سنقدّم طلبك تلقائياً، وسيتواصل معك المؤسس قريباً للخطوات التالية.':'Thanks, your answers are saved. Send your CV here as a PDF or DOCX file (up to 8 MB). We’ll submit your application automatically, and the Founder will contact you soon about the next steps.',state:{...previous,language,step,greeted:true,answers},buttons:[]};
   }
   const question=screeningQuestion(step,language);
   return {reply:question.reply,state:{...previous,language,step,greeted:true,answers},buttons:question.buttons};
  }
  const question=screeningQuestion(step,language);
  return {reply:language==='ar'?'يرجى اختيار أحد الأزرار للمتابعة.':'Please choose one of the buttons to continue.',state:{...previous,language,step,greeted:true},buttons:question.buttons};
 }
 if(Object.hasOwn(SCREENING,step)||['screen_name','screen_email','screen_contact_number'].includes(step)){
  const question=screeningQuestion(step,language);
  return {reply:question.reply,state:{...previous,language,step,greeted:true,answers:previous.answers||{}},buttons:question.buttons};
 }
 if(step==='screening_declined')return {reply:language==='ar'?'لم يتم حفظ إجاباتك. يمكنك مراجعة تفاصيل الوظيفة أو التحدث مع المؤسس.':'Your answers were not saved. You can review the role or ask to speak with the Founder.',state:{...previous,language,greeted:true,answers:{}},buttons:buttons([['about_role',labels.role],['talk_to_founder',labels.human],['main_menu',labels.menu]])};
 if(step==='screen_complete'||step==='awaiting_cv')return {reply:language==='ar'?'أرسل سيرتك الذاتية هنا كملف PDF أو DOCX (حتى 8 ميغابايت). سنكمل تقديم طلبك تلقائياً.':'Please send your CV here as a PDF or DOCX file (up to 8 MB). We’ll submit your application automatically.',state:{...previous,language,step:'awaiting_cv',greeted:true,answers:previous.answers||{}},buttons:[]};
 if(step==='welcome'){
  const base=text(config,'welcome',language,language==='ar'?'مرحباً بك!':'Hello and welcome!');
  const company=`${language==='ar'?'نحن':'We are'} Sitta Arbaa Sitta for Software Solutions (${language==='ar'?'السجل التجاري':'CR'} 251489), ${language==='ar'?'شركة برمجيات وتسويق مقرها قطر. طلب هو سوقنا الإلكتروني في قطر':'a Qatar-based software and marketing company. Talab is our marketplace app for Qatar'}.`;
  const apps=`Talab · Apple: ${APPLE}\nGoogle Play: ${ANDROID}`;
  const salemax=language==='ar'?'أنا لوسي، مساعدة SaleMaX. SaleMaX هو CRM لإدارة الأعمال، قابل للتخصيص حسب كل شركة. يساعد على تنظيم العملاء المحتملين، متابعة العملاء، أتمتة المهام، حملات واتساب والتسويق، وإدارة أعمالك من مكان واحد. تعرّف عليه عبر crm.salemax.qa.':'I’m Lucy, SaleMaX’s chatbot. SaleMaX is a CRM and business-management system that can be customised for each business. It helps manage leads and customer follow-ups, automate tasks, run WhatsApp campaigns and marketing, and organise business operations. Learn more at crm.salemax.qa.';
  reply=[base,company,apps,salemax,text(config,'menuPrompt',language,language==='ar'?'اختر موضوعاً للمتابعة:':'Choose what you would like to know next:')].join('\n\n');
  choices=buttons([['about_talab',labels.talab],['about_salemax',labels.salemax],['about_role',labels.role]]);
 }else if(step==='talab'){
  reply=language==='ar'?`طلب هو تطبيق سوق إلكتروني يساعد الناس والأعمال في قطر على عرض المنتجات والخدمات والعثور عليها.\nApple: ${APPLE}\nGoogle Play: ${ANDROID}`:`Talab is our marketplace app for people and businesses in Qatar to discover and list products and services.\nApple App Store: ${APPLE}\nGoogle Play: ${ANDROID}`;
  choices=buttons([['about_salemax',labels.salemax],['about_role',labels.role],['main_menu',labels.menu]]);
 }else if(step==='salemax'){
  reply=language==='ar'?'SaleMaX هو نظام CRM وإدارة أعمال نطوره ونخصصه لكل شركة. يشمل إدارة العملاء المحتملين ومتابعة العملاء، أتمتة المهام، حملات واتساب والتسويق، وأدوات لإدارة الأعمال من مكان واحد. للمزيد: crm.salemax.qa.':'SaleMaX is our CRM and business-management software, customised for each business. It helps teams manage leads and customer follow-ups, automate tasks, run WhatsApp campaigns and marketing, and organise business operations in one place. Learn more at crm.salemax.qa.';
  choices=buttons([['about_role',labels.role],['about_talab',labels.talab],['main_menu',labels.menu]]);
 }else if(step==='role'){
  reply=language==='ar'?'نبحث عن مساعد مبيعات تقنية وبرمجيات عن بُعد في الهند. نحن نوفر العملاء المحتملين. ستتحدث مع أصحاب الأعمال، وتشرح SaleMaX، وتقدم عروضاً عبر Google Meet، وتتابع معهم لإتمام الاشتراك السنوي. سيدعمك مدير المبيعات في عملك اليومي. إجادة الإنجليزية مطلوبة؛ والهندية مفيدة لكنها اختيارية.':'We’re hiring a remote IT/SaaS Sales Associate in India. We provide the leads. You’ll talk with business owners, explain SaleMaX, give demos on Google Meet, and follow up to close yearly subscriptions. Our Sales Manager will support you. Strong English is required; Hindi is helpful but optional.';
  choices=buttons([['start_screening',labels.screening],['commission_details',labels.commission],['talk_to_recruiter',labels.human]]);
 }else if(step==='commission'){
  reply=language==='ar'?'الأشهر الثلاثة الأولى فترة تجربة بالعمولة فقط، من دون راتب أساسي. نحن نوفر العملاء المحتملين. عن كل اشتراك سنوي مدفوع بقيمة 2500 ريال قطري، تحصل على 15% عمولة، أي 375 ريالاً قطرياً لكل عملية بيع. بعد التجربة، قد نعرض عليك وظيفة بدوام كامل براتب أساسي وعمولة، حسب الأداء والاتفاق بيننا.':'The first three months are a commission-only trial, with no base salary. We provide the leads. For each paid QAR 2,500 yearly subscription, you earn 15% commission — QAR 375 per sale. After the trial, we may offer a full-time role with a basic salary plus commission, depending on performance and mutual agreement.';
  choices=buttons([['start_screening',labels.screening],['apply_now',labels.apply],['main_menu',labels.menu]]);
 }else if(step==='apply'){
  if(previous.screeningConsent&&previous.answers?.fullName){reply=language==='ar'?'أكمل بياناتك من البداية، أو استخدم رابط طلبك المحفوظ لإرسال السيرة الذاتية.':'Let’s go through your application details. You can also use your saved application link to upload your CV.';const question=screeningQuestion('screen_name',language);reply+=`\n\n${question.reply}`;choices=question.buttons;step='screen_name';}
  else{const question=screeningQuestion('screen_consent',language);reply=question.reply;choices=question.buttons;step='screen_consent';}
 }else if(step==='human'){
  reply=language==='ar'?'أبلغت مسؤول التوظيف برغبتك في التحدث معه، وسينضم إلى المحادثة قريباً. سأحفظ إجاباتك في قسم التوظيف الخاص ليتمكن الفريق من مراجعتها. هل أجمع معلوماتك الأولية ونتابع أسئلة التقديم أثناء الانتظار؟':'I’ve notified the recruiter that you’d like to speak. They’ll join this chat soon. I’ll save your answers in our private recruitment area for the team to review. Shall I collect your preliminary details and continue the application questions while you wait?';
  choices=buttons([['continue_application',language==='ar'?'نعم، تابع':'Yes, continue'],['wait_for_recruiter',language==='ar'?'سأنتظر':'I’ll wait']]);
  return {reply,state:{...previous,language,step:'human',greeted:true,answers:previous.answers||{}},buttons:choices,notifyRecruiter:true};
 }else if(step==='wait_recruiter'){
  reply=language==='ar'?'حسناً، أبلغت مسؤول التوظيف وسينضم إلى المحادثة قريباً.':'Okay. I’ve notified the recruiter, and they’ll join this chat soon.';choices=[];step='human';
 }else if(step==='application_saved'){
  reply=language==='ar'?'لا مشكلة. تم حفظ طلبك، وحالة السيرة الذاتية هي «لم تُرفع». يمكنك إرسالها هنا أو استخدام رابط طلبك لاحقاً. سيتواصل معك المؤسس قريباً.':'No problem. Your application is saved with CV status “Not uploaded.” You can send it here or use your application link later. The Founder will contact you soon.';choices=[];
 }else{
  reply=language==='ar'?'أبلغت مسؤول التوظيف برغبتك في التحدث معه، وسينضم إلى المحادثة قريباً. سأحفظ إجاباتك في قسم التوظيف الخاص ليتمكن الفريق من مراجعتها. هل أجمع معلوماتك الأولية ونتابع أسئلة التقديم أثناء الانتظار؟':'I’ve notified the recruiter that you’d like to speak. They’ll join this chat soon. I’ll save your answers in our private recruitment area for the team to review. Shall I collect your preliminary details and continue the application questions while you wait?';
  choices=buttons([['continue_application',language==='ar'?'نعم، تابع':'Yes, continue'],['wait_for_recruiter',language==='ar'?'سأنتظر':'I’ll wait']]);step='human';
 }
 return {reply,state:{...previous,language,step,greeted:true,answers:previous.answers||{}},buttons:choices};
}
module.exports={recruitmentReply};
