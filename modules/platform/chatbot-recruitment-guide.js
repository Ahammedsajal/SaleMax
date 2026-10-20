'use strict';
function normalize(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}

const APPLE='https://apps.apple.com/qa/app/%D8%B9%D8%B1%D8%B6-%D9%88-%D8%B7%D9%84%D8%A8-%D9%82%D8%B7%D8%B1-talab-qtr/id6744091784';
const ANDROID='https://play.google.com/store/apps/details?id=com.talab.white';
function text(config,key,language,fallback){return config?.messages?.[key]?.[language]||fallback;}
function buttons(items){return items.slice(0,3).map(([id,title])=>({id,title}));}
const SCREENING={
 screen_consent:{
  question:{en:'Before these quick screening questions, may we save your answers with your recruitment conversation for the Sales team to review? You can decline and apply through the CV form instead.',ar:'قبل أسئلة الفرز السريعة، هل تسمح بحفظ إجاباتك مع محادثة التوظيف ليطّلع عليها فريق المبيعات؟ يمكنك الرفض والتقديم عبر نموذج السيرة الذاتية بدلاً من ذلك.'},
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
 const labels={talab:text(config,'buttonTalab',language,language==='ar'?'عن طلب':'About Talab'),salemax:text(config,'buttonSalemax',language,language==='ar'?'عن SaleMaX':'About SaleMaX'),role:text(config,'buttonRole',language,language==='ar'?'عن الوظيفة':'About the role'),commission:text(config,'buttonCommission',language,language==='ar'?'العمولة':'Commission'),apply:text(config,'buttonApply',language,language==='ar'?'قدّم الآن':'Apply now'),menu:text(config,'buttonMenu',language,language==='ar'?'القائمة':'Main menu'),human:text(config,'buttonHuman',language,language==='ar'?'تحدث إلى المؤسس':'Talk to the Founder'),screening:text(config,'buttonScreening',language,language==='ar'?'أسئلة سريعة':'Quick questions')};
 const match=(...terms)=>terms.some(term=>input===normalize(term)||input.includes(normalize(term)));
 const screeningStep=Object.hasOwn(SCREENING,step)||['screen_name','screen_email','screen_contact_number'].includes(step);
 let command=null;
 if(match('main_menu','main menu','القائمة','الرئيسية','start over',labels.menu))command='welcome';
 else if(match('about_talab','about talab','طلب','talab',labels.talab))command='talab';
 else if(match('about_salemax','about salemax','salemax','سالمكس',labels.salemax))command='salemax';
 else if(match('commission_details','commission details','commission only','pay and commission','pay commission','commission','pay','العمولة','الراتب','عمولة',labels.commission))command='commission';
 else if(match('apply_now','apply now','apply and upload cv','apply upload cv','application','apply','cv','resume','ابدأ التقديم','قدم الآن','قدّم الآن',labels.apply))command='apply';
  else if(match('start_screening','quick questions','screening','ابدأ الأسئلة','أسئلة سريعة'))command=previous.screeningConsent?'screen_name':'screen_consent';
 else if(match('about_role','about the role','role','requirements','job','الوظيفة','الدور','العمل',labels.role))command='role';
 else if(match('talk_to_founder','talk to founder','talk to owner','talk to the owner','موظف','المؤسس','المالك','تحدث مع المؤسس','تحدث مع المالك',labels.human))command='human';
 if(command)step=command;
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
    if(option[2]==='no')return {reply:language==='ar'?'حسنًا، لن نحفظ إجابات الفرز. يمكنك التقديم عبر النموذج الآمن ورفع سيرتك الذاتية.':'Understood. We will not save screening answers. You can apply through the secure form and upload your CV.',state:{...previous,language,step:'screening_declined',screeningConsent:false,answers:{}},buttons:buttons([['apply_now',labels.apply],['about_role',labels.role],['main_menu',labels.menu]])};
    const question=screeningQuestion('screen_name',language);
    return {reply:question.reply,state:{...previous,language,step:'screen_name',screeningConsent:true,greeted:true,answers:{whatsappNumber:previous.whatsappNumber||''}},buttons:question.buttons};
   }
   const answers={...(previous.answers||{}),[SCREENING_FIELDS[step]]:option[2]};
   const next=step==='screen_phone_same'&&option[2]==='other'?'screen_contact_number':SCREENING_NEXT[step];
   if(step==='screen_phone_same'&&option[2]==='same')answers.contactNumber=answers.whatsappNumber||'';
   if(next)step=next;
   else{
    step='screen_complete';
    const names={location:answers.location==='india'?'based in India':'outside India',englishLevel:answers.englishLevel,hindiLevel:answers.hindiLevel,salesExperience:answers.salesExperience,availability:answers.availability};
    const summary=`Location: ${names.location}; English: ${names.englishLevel}; Hindi: ${names.hindiLevel}; sales background: ${names.salesExperience}; availability: ${names.availability}.`;
    return {reply:language==='ar'?`شكراً، تم حفظ إجاباتك في قسم التوظيف الخاص: ${summary}\nأكمل طلبك وارفع سيرتك الذاتية لتكتمل بياناتك.`:`Thanks. Your answers are saved in the private recruitment review area: ${summary}\nComplete the application and upload your CV to finish your application.`,state:{...previous,language,step,greeted:true,answers},buttons:buttons([['apply_now',labels.apply],['talk_to_founder',labels.human],['main_menu',labels.menu]])};
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
 if(step==='screening_declined')return {reply:language==='ar'?'لم يتم حفظ إجابات الفرز. يمكنك التقديم عبر النموذج أو مراجعة تفاصيل الوظيفة.':'Screening answers were not saved. You can apply through the CV form or review the role details.',state:{...previous,language,greeted:true,answers:{}},buttons:buttons([['apply_now',labels.apply],['about_role',labels.role],['main_menu',labels.menu]])};
 if(step==='screen_complete')return {reply:(language==='ar'?'تم حفظ إجاباتك. استخدم الرابط لمراجعة بياناتك ورفع سيرتك الذاتية. سيتواصل معك مؤسس الشركة قريباً بشأن الخطوات التالية.':'Thanks, your answers are saved. Use the link to review your details and upload your CV. Our Founder will contact you soon about the next steps.')+(previous.applicationUrl?`\n${previous.applicationUrl}`:''),state:{...previous,language,step,greeted:true,answers:previous.answers||{}},buttons:buttons([['apply_now',labels.apply],['talk_to_founder',labels.human],['main_menu',labels.menu]])};
 if(step==='welcome'){
  const base=text(config,'welcome',language,language==='ar'?'مرحباً بك!':'Hello and welcome!');
  const company=`${language==='ar'?'نحن':'We are'} Sitta Arbaa Sitta for Software Solutions (${language==='ar'?'السجل التجاري':'CR'} 251489), ${language==='ar'?'شركة برمجيات وتسويق مقرها قطر. طلب هو سوقنا الإلكتروني في قطر':'a Qatar-based software and marketing company. Talab is our marketplace app for Qatar'}.`;
  const apps=`Talab · Apple: ${APPLE}\nGoogle Play: ${ANDROID}`;
  const salemax=language==='ar'?'SaleMaX هو برنامج CRM مخصص لإدارة الأعمال. سيعمل مساعد المبيعات مع مدير مبيعات SaleMaX الذي سيوجهه في أنشطة المبيعات اليومية.':'SaleMaX is our CRM software for customised business management. You will work with the SaleMaX Sales Manager, who will guide your day-to-day sales activities.';
  reply=[base,company,apps,salemax,text(config,'menuPrompt',language,language==='ar'?'اختر موضوعاً للمتابعة:':'Choose what you would like to know next:')].join('\n\n');
  choices=buttons([['about_talab',labels.talab],['about_salemax',labels.salemax],['about_role',labels.role]]);
 }else if(step==='talab'){
  reply=language==='ar'?`طلب هو تطبيق سوق إلكتروني يساعد الناس والأعمال في قطر على عرض المنتجات والخدمات والعثور عليها.\nApple: ${APPLE}\nGoogle Play: ${ANDROID}`:`Talab is our marketplace app for people and businesses in Qatar to discover and list products and services.\nApple App Store: ${APPLE}\nGoogle Play: ${ANDROID}`;
  choices=buttons([['about_salemax',labels.salemax],['about_role',labels.role],['main_menu',labels.menu]]);
 }else if(step==='salemax'){
  reply=language==='ar'?'SaleMaX هو برنامج CRM مخصص لإدارة الأعمال، يشمل تنظيم العملاء والتواصل وأدوات المبيعات. سيوجه مدير المبيعات أنشطتك اليومية.':'SaleMaX is our CRM and customised business-management software. It helps businesses organise customer communication and sales work. The Sales Manager will guide your day-to-day sales activities.';
  choices=buttons([['about_role',labels.role],['about_talab',labels.talab],['main_menu',labels.menu]]);
 }else if(step==='role'){
  reply=language==='ar'?'نبحث عن مساعد مبيعات تقنية وبرمجيات عن بُعد في الهند. نحن نوفر العملاء المحتملين. ستتحدث مع أصحاب الأعمال، وتشرح SaleMaX، وتقدم عروضاً عبر Google Meet، وتتابع معهم لإتمام الاشتراك السنوي. سيدعمك مدير المبيعات في عملك اليومي. إجادة الإنجليزية مطلوبة؛ والهندية مفيدة لكنها اختيارية.':'We’re hiring a remote IT/SaaS Sales Associate in India. We provide the leads. You’ll talk with business owners, explain SaleMaX, give demos on Google Meet, and follow up to close yearly subscriptions. Our Sales Manager will support you. Strong English is required; Hindi is helpful but optional.';
  choices=buttons([['start_screening',labels.screening],['commission_details',labels.commission],['apply_now',labels.apply]]);
 }else if(step==='commission'){
  reply=language==='ar'?'أول شهرين إلى ثلاثة أشهر فترة تجربة بالعمولة فقط، من دون راتب أساسي. نحن نوفر العملاء المحتملين. عن كل اشتراك سنوي مدفوع بقيمة 2500 ريال قطري، تحصل على 15% عمولة، أي 375 ريالاً قطرياً لكل عملية بيع. بعد التجربة، قد نعرض عليك وظيفة بدوام كامل براتب أساسي وعمولة، حسب الأداء والاتفاق بيننا.':'The first 2–3 months are a commission-only trial, with no base salary. We provide the leads. For each paid QAR 2,500 yearly subscription, you earn 15% commission — QAR 375 per sale. After the trial, we may offer a full-time role with a basic salary plus commission, depending on performance and mutual agreement.';
  choices=buttons([['start_screening',labels.screening],['apply_now',labels.apply],['main_menu',labels.menu]]);
 }else if(step==='apply'){
  const url=previous.applicationUrl||facts.find(item=>item.kind==='recruitment_application')?.url;
  if(!url){reply=language==='ar'?'نموذج التقديم غير متاح مؤقتاً. يرجى طلب التحدث إلى المؤسس.':'The application form is temporarily unavailable. Please ask to speak with the Founder.';choices=buttons([['talk_to_owner',labels.human],['main_menu',labels.menu]]);step='human';}
  else{reply=language==='ar'?`للتقديم، أكمل النموذج وارفع سيرتك الذاتية من هنا:\n${url}\nنقبل ملفات PDF أو DOCX حتى 8 ميجابايت. سيصل طلبك إلى قسم Applications & CVs الخاص للمراجعة.`:`To apply, complete the form and upload your CV here:\n${url}\nWe accept PDF or DOCX files up to 8 MB. Your application will go to our private Applications & CVs review area.`;choices=buttons([['about_role',labels.role],['main_menu',labels.menu]]);}
 }else if(step==='human'){
  const answers=previous.answers||{};
  if(previous.screeningConsent!==true||!answers.fullName){
   reply=language==='ar'?'لإرسال بياناتك إلى المؤسس، أجب أولاً عن الأسئلة السريعة. ويمكنك أيضاً التقديم ورفع سيرتك الذاتية.':'To share your details with the Founder, please answer the quick questions first. You can also apply and upload your CV.';
   choices=buttons([['start_screening',labels.screening],['apply_now',labels.apply],['main_menu',labels.menu]]);
  }else{
   reply=language==='ar'?'شكراً، أرسلت بياناتك إلى المؤسس. سيتواصل معك قريباً.':'Thanks. I’ve shared your details with the Founder, who will contact you soon.';
   choices=buttons([['apply_now',labels.apply],['main_menu',labels.menu]]);
  }
  step='human';
 }else{
  reply=language==='ar'?'يمكنك التقديم عبر النموذج أو اختيار التحدث إلى المؤسس بعد إكمال الأسئلة السريعة.':'You can apply through the form or choose to speak with the Founder after completing the quick questions.';
  choices=buttons([['start_screening',labels.screening],['apply_now',labels.apply],['main_menu',labels.menu]]);
 }
 const founderNotification=command==='human'&&previous.screeningConsent===true&&previous.answers?.fullName?{answers:previous.answers,whatsappNumber:previous.answers.whatsappNumber||'',senderName:previous.answers.fullName}:null;
 return {reply,state:{...previous,language,step,greeted:true,answers:previous.answers||{}},buttons:choices,...(founderNotification?{founderNotification,handoff:true}:{})};
}
module.exports={recruitmentReply};
