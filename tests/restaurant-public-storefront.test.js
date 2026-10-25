'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const tenantDomains=require('../modules/platform/tenant-crm-domains');
const restaurantOrders=require('../modules/platform/restaurant-orders');
const retailOrders=require('../modules/platform/retail-orders');
const storefrontBranches=require('../modules/platform/tenant-storefront-branches');
const plans=require('../modules/platform/plans');
const {sendTenantStorefront}=require('../modules/web/public-website');

test('published restaurant storefront renders bilingual guest request form, script and safe request-only copy',async()=>{
  const oldBrand=tenantDomains.publicBrand,oldCatalog=restaurantOrders.publicCatalog,oldBranches=storefrontBranches.publicBranches;
  const branch={slug:'central',nameEn:'Central',nameAr:'الفرع المركزي',timezone:'Asia/Qatar',openingHours:{monday:[{open:'09:00',close:'18:00'}]},preparationMinutes:15,fulfillmentModes:['pickup','delivery'],acceptingOrders:true};
  tenantDomains.publicBrand=async()=>({revision:3,tenantId:'tenant-1',name:'Cafe',slug:'cafe',categoryKey:'restaurant_cafe',categoryVersion:1,content:{showRestaurantMenu:true,headline:'Cafe',headlineAr:'مقهى',description:'Tea and coffee',descriptionAr:'الشاي والقهوة'},primaryColor:'#123456',accentColor:'#abcdef'});
  restaurantOrders.publicCatalog=async()=>[{branch,items:[{menuItemId:'11111111-1111-4111-8111-111111111111',nameEn:'Tea <b>special</b>',nameAr:'شاي',descriptionEn:'Fresh tea',priceMinor:1200,currency:'QAR',modifierGroups:[]}]}];
  storefrontBranches.publicBranches=async()=>[];
  const render=async(language)=>{let html='',headers={};const connection={release(){}};const pool={async getConnection(){return connection;}};const response={setHeader(name,value){headers[name]=value;},type(){return this;},send(value){html=value;return this;}};await sendTenantStorefront({crmTenantDomain:{hostname:'cafe.example'},path:'/',originalUrl:'/',query:{},get(name){return name.toLowerCase()==='accept-language'?language:'';}},response,pool);return {html,headers};};
  try{
    const english=await render('en');assert.match(english.html,/id="restaurant-orders"/);assert.match(english.html,/href="#restaurant-orders">Order food<\/a>/);assert.match(english.html,/tenant-restaurant-checkout\.js/);assert.match(english.html,/Send a request without creating an account/);assert.match(english.html,/Tea &lt;b&gt;special&lt;\/b&gt;/);assert.doesNotMatch(english.html,/<script(?:\s[^>]*)?>\s*[^<\s]/i);assert.match(english.html,/<script defer src="\/tenant-restaurant-checkout\.js/);assert.match(english.headers['Cache-Control'],/no-store/);assert.match(english.headers['Content-Security-Policy'],/script-src 'self'/);
    const arabic=await render('ar');assert.match(arabic.html,/<html lang="ar" dir="rtl">/);assert.match(arabic.html,/اطلب الطعام/);assert.match(arabic.html,/الفرع المركزي/);assert.match(arabic.html,/لن يصبح الطلب مقبولًا حتى تؤكده المؤسسة/);
  }finally{tenantDomains.publicBrand=oldBrand;restaurantOrders.publicCatalog=oldCatalog;storefrontBranches.publicBranches=oldBranches;}
});

test('fitness and event storefronts show category-specific actions while describing requests as unconfirmed',async()=>{
  const oldBrand=tenantDomains.publicBrand,oldBranches=storefrontBranches.publicBranches,oldEntitlements=plans.loadEntitlements;
  storefrontBranches.publicBranches=async()=>[];plans.loadEntitlements=async(_db,tenantId)=>({status:'active',categoryKey:tenantId,capabilities:['crm.leads']});
  const render=async(categoryKey,language='en',query={})=>{let html='';const pool={async getConnection(){return {release(){}};}},response={setHeader(){},type(){return this;},send(value){html=value;return this;}};tenantDomains.publicBrand=async()=>({revision:1,tenantId:categoryKey,name:'Sample business',slug:'sample',categoryKey,categoryVersion:1,content:{sections:[{type:'services',items:[{title:'Coaching package'}]},...(categoryKey==='events_venues'?[{type:'events',items:[{title:'Open studio demo',titleAr:'عرض الاستوديو المفتوح',body:'Meet the venue team.',startsOn:'2030-06-15'}]}]:[])]},primaryColor:'#123456',accentColor:'#abcdef'});await sendTenantStorefront({crmTenantDomain:{hostname:'sample.example'},path:'/',query,get(name){return name.toLowerCase()==='accept-language'?language:'';}},response,pool);return html;};
  try{
    const fitness=await render('fitness_coaching');assert.match(fitness,/Book a trial or enquire/);assert.match(fitness,/Book a trial \(request only\)/);assert.match(fitness,/No class seat or coach is reserved/);assert.match(fitness,/Package or program/);
    const events=await render('events_venues');assert.match(events,/Request availability or registration/);assert.match(events,/Request venue availability/);assert.match(events,/No venue or capacity is reserved/);assert.match(events,/Venue package/);assert.match(events,/href="\/\?intent=event_registration_request&amp;event=Open\+studio\+demo#enquiry"/);assert.match(events,/Request registration information/);
    const eventRequest=await render('events_venues','en',{intent:'event_registration_request',event:'Open studio demo'});assert.match(eventRequest,/<option value="event_registration_request" selected>/);assert.match(eventRequest,/<option value="Open studio demo" selected>Open studio demo<\/option>/);assert.match(eventRequest,/Please send me registration information about: Open studio demo\./);
    const arabicEventRequest=await render('events_venues','ar',{intent:'event_registration_request',event:'عرض الاستوديو المفتوح'});assert.match(arabicEventRequest,/value="event_registration_request" selected/);assert.match(arabicEventRequest,/value="Open studio demo" selected/);assert.match(arabicEventRequest,/أرغب في معرفة معلومات التسجيل عن: عرض الاستوديو المفتوح\./);
    const arabic=await render('events_venues','ar');assert.match(arabic,/طلب توفر أو تسجيل/);assert.match(arabic,/طلب توفر القاعة/);assert.match(arabic,/لا يحجز القاعة أو السعة/);
  }finally{tenantDomains.publicBrand=oldBrand;storefrontBranches.publicBranches=oldBranches;plans.loadEntitlements=oldEntitlements;}
});

test('retail storefront primary action opens the existing guest cart flow',async()=>{
  const oldBrand=tenantDomains.publicBrand,oldCatalog=retailOrders.publicCatalog,oldBranches=storefrontBranches.publicBranches;
  tenantDomains.publicBrand=async()=>({revision:1,tenantId:'retail-tenant',name:'Boutique',slug:'boutique',categoryKey:'retail_boutique',categoryVersion:1,content:{showProductCatalog:true},primaryColor:'#123456',accentColor:'#abcdef'});
  retailOrders.publicCatalog=async()=>[{variantId:'11111111-1111-4111-8111-111111111111',variantNameEn:'Blue scarf',productNameEn:'Scarf',priceMinor:5000,currency:'QAR',branchSlug:'central',branchNameEn:'Central',pickupAvailable:true,deliveryAvailable:false}];storefrontBranches.publicBranches=async()=>[];
  try{let html='';const pool={async getConnection(){return {release(){}};}},response={setHeader(){},type(){return this;},send(value){html=value;return this;}};await sendTenantStorefront({crmTenantDomain:{hostname:'boutique.example'},path:'/',query:{},get(){return 'en';}},response,pool);assert.match(html,/href="#products">Shop products<\/a>/);assert.match(html,/id="products"/);assert.match(html,/tenant-retail-checkout\.js/);assert.match(html,/Place order/);}
  finally{tenantDomains.publicBrand=oldBrand;retailOrders.publicCatalog=oldCatalog;storefrontBranches.publicBranches=oldBranches;}
});
