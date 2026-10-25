'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const domains=require('../modules/platform/tenant-crm-domains');
const formsPath=require.resolve('../modules/platform/training-forms'),cataloguePath=require.resolve('../modules/platform/tenant-storefront-catalogue'),branchesPath=require.resolve('../modules/platform/tenant-storefront-branches');
require.cache[formsPath]={id:formsPath,filename:formsPath,loaded:true,exports:{publicForm:async()=>null}};
require.cache[cataloguePath]={id:cataloguePath,filename:cataloguePath,loaded:true,exports:{trainingCourses:async()=>[],realEstateProperties:async()=>[]}};
require.cache[branchesPath]={id:branchesPath,filename:branchesPath,loaded:true,exports:{publicBranches:async()=>[]}};
const forms=require('../modules/platform/training-forms');
const catalogue=require('../modules/platform/tenant-storefront-catalogue');
const branches=require('../modules/platform/tenant-storefront-branches');
const {sendTenantStorefront}=require('../modules/web/public-website');

test('published Training Center catalogue is opt-in, tenant-scoped and rendered safely in both locales',async()=>{
  const oldBrand=domains.publicBrand,oldForm=forms.publicForm,oldCourses=catalogue.trainingCourses,oldBranches=branches.publicBranches;
  const calls={catalogue:0,form:0};
  domains.publicBrand=async()=>({name:'Synthetic Center',slug:'synthetic-center',categoryKey:'training_center',categoryVersion:1,tenantId:'tenant-a',logoUrl:'',primaryColor:'#1768d4',accentColor:'#12c9f4',tagline:'Learn',whatsappNumber:'',content:{headline:'Courses',headlineAr:'الدورات',description:'<img src=x onerror=alert(1)>',showCourseCatalog:true,publicFormSlug:'course-enquiry'},revision:1,primaryHostname:'school.example.qa'});
  forms.publicForm=async()=>{calls.form++;return {form:{slug:'course-enquiry'}};};
  catalogue.trainingCourses=async(_db,tenantId)=>{calls.catalogue++;assert.equal(tenantId,'tenant-a');return [{publicId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',nameEn:'First Aid',nameAr:'الإسعافات الأولية',descriptionEn:'<script>bad()</script>Learn safety',descriptionAr:'تعلم السلامة',outcomesEn:'Practice response',outcomesAr:'التدرب على الاستجابة',prerequisitesEn:'No prerequisites',prerequisitesAr:'لا توجد متطلبات',durationValue:2,durationUnit:'days',deliveryMode:'in_person',currency:'QAR',priceMinor:10000,registrationFeeMinor:500,inclusions:['Workbook <safe>'],batches:[{startsOn:'2027-01-10',endsOn:'2027-01-12',language:'en'}]}];};
  branches.publicBranches=async(_db,tenantId)=>{assert.equal(tenantId,'tenant-a');return [{nameEn:'West Branch',nameAr:'فرع الغرب',addressEn:'West Bay',addressAr:'الخليج الغربي',phone:'+97412345678',timezone:'Asia/Qatar',openingHours:{monday:[{open:'09:00',close:'17:00'}]},serviceAreas:['Doha'],fulfillmentModes:['in_person'],routingMembershipId:'internal-route-id',bookingMode:'capacity_reserved'}];};
  try{
    for(const [language,title,cta] of [['en','Available courses','Enquire about this course'],['ar-QA','الدورات المتاحة','استفسر عن هذه الدورة']]){
      const response={headers:{},setHeader(name,value){this.headers[name]=value;},type(){return this;},send(body){this.body=body;return this;}};
      const pool={async getConnection(){return {release(){}};}};
      await sendTenantStorefront({path:'/',crmTenantDomain:{hostname:'school.example.qa'},get(name){return name==='accept-language'?language:'';}},response,pool);
      assert.match(response.body,new RegExp(title));assert.match(response.body,new RegExp(cta));assert.match(response.body,/First Aid|الإسعافات الأولية/);assert.match(response.body,language==='en'?/Practice response/:/التدرب على الاستجابة/);assert.match(response.body,language==='en'?/No prerequisites/:/لا توجد متطلبات/);assert.match(response.body,/2027-01-10/);assert.match(response.body,language==='en'?/Upcoming schedules \(request only\)/:/المواعيد القادمة \(للاستفسار فقط\)/);assert.match(response.body,language==='en'?/West Branch/:/فرع الغرب/);assert.match(response.body,language==='en'?/Opening hours/:/ساعات العمل/);assert.doesNotMatch(response.body,/internal-route-id|capacity_reserved/);if(language==='en')assert.match(response.body,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.doesNotMatch(response.body,/<script>/);assert.match(response.body,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(response.headers['Content-Security-Policy'],/script-src 'none'/);
    }
    assert.equal(calls.form,2);assert.equal(calls.catalogue,2);
  }finally{domains.publicBrand=oldBrand;forms.publicForm=oldForm;catalogue.trainingCourses=oldCourses;branches.publicBranches=oldBranches;}
});

test('published courses have stable, indexable detail URLs with a course-specific guest enquiry action',async()=>{
  const oldBrand=domains.publicBrand,oldForm=forms.publicForm,oldCourses=catalogue.trainingCourses,oldBranches=branches.publicBranches;
  const publicId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  domains.publicBrand=async()=>({name:'Synthetic Center',slug:'synthetic-center',categoryKey:'training_center',categoryVersion:1,tenantId:'tenant-a',logoUrl:'',primaryColor:'#1768d4',accentColor:'#12c9f4',tagline:'Learn',whatsappNumber:'',content:{headline:'Courses',description:'Welcome',showCourseCatalog:true,publicFormSlug:'course-enquiry'},revision:1,primaryHostname:'school.example.qa'});
  forms.publicForm=async()=>({form:{slug:'course-enquiry'}});
  catalogue.trainingCourses=async()=>[{publicId,nameEn:'First Aid',nameAr:'الإسعافات الأولية',descriptionEn:'Safety course',descriptionAr:'دورة السلامة',outcomesEn:'Respond safely',outcomesAr:'الاستجابة بأمان',prerequisitesEn:'None',prerequisitesAr:'لا يوجد',durationValue:2,durationUnit:'days',deliveryMode:'in_person',currency:'QAR',priceMinor:10000,registrationFeeMinor:0,inclusions:[],batches:[]}];
  branches.publicBranches=async()=>[];
  try{
    const response={headers:{},status(value){this.statusCode=value;return this;},setHeader(name,value){this.headers[name]=value;},type(){return this;},send(body){this.body=body;return this;}};
    await sendTenantStorefront({path:`/courses/${publicId}`,crmTenantDomain:{hostname:'school.example.qa'},get(name){return name==='accept-language'?'en':'';}},response,{async getConnection(){return {release(){}};}});
    assert.equal(response.statusCode,undefined);assert.match(response.body,/<title>First Aid \| Synthetic Center<\/title>/);assert.match(response.body,/<meta property="og:type" content="website">/);assert.match(response.body,/<link rel="canonical" href="https:\/\/school\.example\.qa\/courses\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa">/);assert.match(response.body,/href="https:\/\/7network\.live\/p\/synthetic-center\/forms\/course-enquiry\?course_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/);assert.match(response.body,/Safety course/);
  }finally{domains.publicBrand=oldBrand;forms.publicForm=oldForm;catalogue.trainingCourses=oldCourses;branches.publicBranches=oldBranches;}
});


test('published Real Estate catalogue renders bilingual property cards and safe request-only detail pages',async()=>{
  const oldBrand=domains.publicBrand,oldProperties=catalogue.realEstateProperties,oldBranches=branches.publicBranches;
  const publicId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  domains.publicBrand=async()=>({name:'Synthetic Realty',slug:'synthetic-realty',categoryKey:'real_estate',categoryVersion:1,tenantId:'tenant-re',logoUrl:'',primaryColor:'#1768d4',accentColor:'#12c9f4',content:{headline:'Find a home',headlineAr:'ابحث عن منزل',description:'Homes',showPropertyCatalog:true},revision:2,primaryHostname:'realty.example.qa'});
  const row={publicId,referenceCode:'RE-100',titleEn:'West Bay Villa',titleAr:'فيلا الخليج الغربي',propertyType:'villa',transactionType:'sale',priceMinor:250000000,currency:'QAR',areaSqm:320,bedrooms:4,bathrooms:3,city:'Doha',branchNameEn:'West Branch',branchNameAr:'فرع الغرب',branchAddressEn:'West Bay',branchAddressAr:'الخليج الغربي',descriptionEn:'<script>private()</script>Family villa',descriptionAr:'فيلا عائلية'};
  catalogue.realEstateProperties=async(_db,tenantId,categoryKey,version)=>{assert.equal(tenantId,'tenant-re');assert.equal(categoryKey,'real_estate');assert.equal(version,1);return [row];};branches.publicBranches=async()=>[];
  try{
    for(const [language,title,action] of [['en','West Bay Villa','Request a viewing'],['ar','فيلا الخليج الغربي','طلب معاينة']]){
      const response={headers:{},setHeader(name,value){this.headers[name]=value;},type(){return this;},send(body){this.body=body;return this;}};
      await sendTenantStorefront({path:'/',crmTenantDomain:{hostname:'realty.example.qa'},get(name){return name==='accept-language'?language:'';}},response,{async getConnection(){return {release(){}};}},'https://public.example.qa');
      assert.match(response.body,new RegExp(title));assert.match(response.body,new RegExp(action));assert.match(response.body,language==='en'?/West Branch · West Bay/:/فرع الغرب · الخليج الغربي/);assert.match(response.body,/href="\/properties\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"/);assert.match(response.body,/https:\/\/public\.example\.qa\/p\/synthetic-realty\/properties\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\/viewing/);assert.doesNotMatch(response.body,/<script>/);assert.match(response.body,/does not reserve or confirm|لا يؤكد أو يحجز/);
    }
    const response={setHeader(){},type(){return this;},send(body){this.body=body;return this;}};
    await sendTenantStorefront({path:`/properties/${publicId}`,crmTenantDomain:{hostname:'realty.example.qa'},get(){return 'en';}},response,{async getConnection(){return {release(){}};}});
    assert.match(response.body,/<title>West Bay Villa \| Synthetic Realty<\/title>/);assert.match(response.body,/<link rel="canonical" href="https:\/\/realty\.example\.qa\/properties\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb">/);assert.match(response.body,/Family villa/);assert.match(response.body,/&lt;script&gt;private\(\)&lt;\/script&gt;/);assert.doesNotMatch(response.body,/<script>/);
  }finally{domains.publicBrand=oldBrand;catalogue.realEstateProperties=oldProperties;branches.publicBranches=oldBranches;}
});

test('public storefront omits the catalogue unless the tenant published the opt-in setting',async()=>{
  const oldBrand=domains.publicBrand,oldCourses=catalogue.trainingCourses,oldBranches=branches.publicBranches;let queried=false;
  domains.publicBrand=async()=>({name:'Synthetic',slug:'synthetic',categoryKey:'training_center',tenantId:'tenant-a',content:{headline:'Welcome',showCourseCatalog:false},revision:1,primaryHostname:'school.example.qa'});
  catalogue.trainingCourses=async()=>{queried=true;return [];};
  try{const response={setHeader(){},type(){return this;},send(body){this.body=body;return this;}};await sendTenantStorefront({crmTenantDomain:{hostname:'school.example.qa'},get(){return 'en';}},response,{async getConnection(){return {release(){}};}});assert.doesNotMatch(response.body,/Available courses/);assert.equal(queried,false);}finally{domains.publicBrand=oldBrand;catalogue.trainingCourses=oldCourses;branches.publicBranches=oldBranches;}
});

test('public storefront renders reusable sections bilingually and escapes section content',async()=>{
  const oldBrand=domains.publicBrand,oldCourses=catalogue.trainingCourses,oldBranches=branches.publicBranches,plans=require('../modules/platform/plans'),oldEntitlements=plans.loadEntitlements;
  domains.publicBrand=async()=>({name:'Synthetic',slug:'synthetic',categoryKey:'professional_services',tenantId:'tenant-a',content:{headline:'Welcome',sections:[{type:'faq',title:'Questions',titleAr:'الأسئلة',items:[{title:'Can I book?',titleAr:'هل يمكنني الحجز؟',body:'<script>bad()</script>Request a booking',bodyAr:'أرسل طلب حجز'}]},{type:'team',title:'Our team',titleAr:'فريقنا',items:[{title:'Advisor',titleAr:'مستشار',body:'Expert help',bodyAr:'مساعدة متخصصة'}]},{type:'updates',title:'Updates',items:[{title:'Expired announcement',body:'Expired body',expiresOn:'2000-01-01'},{title:'Current announcement',body:'Current body',expiresOn:'2099-12-31'}]},{type:'events',title:'Events',items:[{title:'Open day',body:'Join us',startsOn:'2099-06-15',expiresOn:'2099-06-15'}]},{type:'faq',title:'Empty FAQ',items:[]}]},revision:1,primaryHostname:'example.qa'});
  catalogue.trainingCourses=async()=>[];branches.publicBranches=async()=>[];plans.loadEntitlements=async()=>({status:'active',categoryKey:'professional_services',capabilities:['crm.leads']});
  try{
    for(const [language,heading,question,answer] of [['en','Questions','Can I book?','Request a booking'],['ar','الأسئلة','هل يمكنني الحجز؟','أرسل طلب حجز']]){
      const response={setHeader(){},type(){return this;},send(body){this.body=body;return this;}};
      await sendTenantStorefront({crmTenantDomain:{hostname:'example.qa'},get(name){return name==='accept-language'?language:'';}},response,{async getConnection(){return {release(){}};}});
      assert.match(response.body,new RegExp(heading));assert.match(response.body,new RegExp(question));assert.match(response.body,new RegExp(answer));assert.match(response.body,/<details class="storefront-faq">/);assert.match(response.body,/Our team|فريقنا/);assert.match(response.body,/Current announcement/);assert.match(response.body,/Open day/);assert.match(response.body,/<time datetime="2099-06-15">/);assert.doesNotMatch(response.body,/Expired announcement|Expired body|Empty FAQ/);assert.doesNotMatch(response.body,/<script>/);if(language==='en')assert.match(response.body,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    }
  }finally{domains.publicBrand=oldBrand;catalogue.trainingCourses=oldCourses;branches.publicBranches=oldBranches;plans.loadEntitlements=oldEntitlements;}
});

test('public storefront suppresses course listings when its guest form is no longer available',async()=>{
  const oldBrand=domains.publicBrand,oldForm=forms.publicForm,oldCourses=catalogue.trainingCourses,oldBranches=branches.publicBranches;let queried=false;
  domains.publicBrand=async()=>({name:'Synthetic',slug:'synthetic',categoryKey:'training_center',tenantId:'tenant-a',content:{headline:'Welcome',showCourseCatalog:true,publicFormSlug:'course-enquiry'},revision:1,primaryHostname:'school.example.qa'});
  forms.publicForm=async()=>null;catalogue.trainingCourses=async()=>{queried=true;return [];};
  try{const response={setHeader(){},type(){return this;},send(body){this.body=body;return this;}};await sendTenantStorefront({crmTenantDomain:{hostname:'school.example.qa'},get(){return 'en';}},response,{async getConnection(){return {release(){}};}});assert.doesNotMatch(response.body,/Available courses/);assert.match(response.body,/Contact us/);assert.equal(queried,false);}finally{domains.publicBrand=oldBrand;forms.publicForm=oldForm;catalogue.trainingCourses=oldCourses;branches.publicBranches=oldBranches;}
});

test('salon storefront offers bilingual service-linked appointment requests without implying a reservation',async()=>{
  const oldBrand=domains.publicBrand,oldBranches=branches.publicBranches,plans=require('../modules/platform/plans'),oldEntitlements=plans.loadEntitlements;
  domains.publicBrand=async()=>({name:'Synthetic Salon',slug:'synthetic-salon',categoryKey:'salon_spa',categoryVersion:1,tenantId:'tenant-salon',content:{headline:'Salon',headlineAr:'صالون',description:'Care with our team',sections:[{type:'services',title:'Services',titleAr:'الخدمات',items:[{title:'Hair consultation',titleAr:'استشارة الشعر',body:'Discuss a look',bodyAr:'اختاري إطلالتك'}]}]},revision:1,primaryHostname:'salon.example.qa'});
  branches.publicBranches=async()=>[{slug:'west',nameEn:'West branch',nameAr:'فرع الغرب'}];
  plans.loadEntitlements=async()=>({status:'active',categoryKey:'salon_spa',capabilities:['crm.leads']});
  try{
    for(const [language,cta,notice] of [['en','Request an appointment','no staff member or room is reserved'],['ar','طلب موعد','لن يتم حجز موظف أو غرفة']]){
      const response={setHeader(){},type(){return this;},send(body){this.body=body;return this;}};
      await sendTenantStorefront({path:'/',crmTenantDomain:{hostname:'salon.example.qa'},get(name){return name==='accept-language'?language:'';}},response,{async getConnection(){return {release(){}};}});
      assert.match(response.body,new RegExp(cta));assert.match(response.body,new RegExp(notice));assert.match(response.body,/name="intent" value="booking_request"/);assert.match(response.body,/name="preferredDate"/);assert.match(response.body,/name="preferredTime"/);assert.match(response.body,/Hair consultation|استشارة الشعر/);assert.match(response.body,/name="branchSlug"/);assert.match(response.body,/appointment is not confirmed|لم يتم تأكيد الموعد/);assert.doesNotMatch(response.body,/name="intent"><select/);
    }
  }finally{domains.publicBrand=oldBrand;branches.publicBranches=oldBranches;plans.loadEntitlements=oldEntitlements;}
});

test('Home services storefront offers covered branch visit or quote requests without claiming dispatch',async()=>{
  const oldBrand=domains.publicBrand,oldBranches=branches.publicBranches,plans=require('../modules/platform/plans'),oldEntitlements=plans.loadEntitlements;
  domains.publicBrand=async()=>({name:'Synthetic Home Services',slug:'synthetic-home',categoryKey:'home_services',categoryVersion:1,tenantId:'tenant-home',content:{headline:'Home repairs',headlineAr:'صيانة المنازل',sections:[{type:'services',title:'Services',titleAr:'الخدمات',items:[{title:'Plumbing repair',titleAr:'إصلاح السباكة',body:'Repair and maintenance',bodyAr:'إصلاح وصيانة'}]}]},revision:1,primaryHostname:'repairs.example.qa'});
  branches.publicBranches=async()=>[{slug:'doha-west',nameEn:'Doha West',nameAr:'غرب الدوحة',serviceAreas:['Al Waab','Ain Khaled'],fulfillmentModes:['onsite'],openingHours:{monday:[{open:'08:00',close:'17:00'}]}}];
  plans.loadEntitlements=async()=>({status:'active',categoryKey:'home_services',capabilities:['crm.leads']});
  try{
    for(const [language,cta,notice,addressLabel] of [['en','Request a visit or quote','no visit or technician is confirmed','Service address'],['ar','طلب زيارة أو عرض سعر','لم يتم تأكيد الزيارة أو تعيين فني','عنوان الخدمة']]){
      const response={setHeader(){},type(){return this;},send(body){this.body=body;return this;}};
      await sendTenantStorefront({path:'/',crmTenantDomain:{hostname:'repairs.example.qa'},get(name){return name==='accept-language'?language:'';}},response,{async getConnection(){return {release(){}};}});
      assert.match(response.body,new RegExp(cta));assert.match(response.body,new RegExp(notice));assert.match(response.body,/name="intent"><option value="visit_request"/);assert.match(response.body,/name="serviceArea" required/);assert.match(response.body,/value="Al Waab"/);assert.match(response.body,/name="serviceAddress" maxlength="500"[^>]*required/);assert.match(response.body,new RegExp(addressLabel));assert.match(response.body,/name="branchSlug" required/);assert.match(response.body,/name="preferredDate"/);assert.match(response.body,/Plumbing repair|إصلاح السباكة/);assert.doesNotMatch(response.body,/Your visit is confirmed|Technician assigned/);
    }
  }finally{domains.publicBrand=oldBrand;branches.publicBranches=oldBranches;plans.loadEntitlements=oldEntitlements;}
});
