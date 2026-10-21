'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {getCategory}=require('../modules/platform/categories');
const pack=require('../modules/platform/chatbot-domain-packs').getDomainPack('real_estate',3);
const {botInput}=require('../modules/platform/chatbot-config');

const tenantId='tenant-real-estate-a';
const category=getCategory('real_estate',3);
function context(overrides={}) { return {audience:'tenant',identity:{id:'identity-a'},tenant:{id:tenantId,status:'active',categoryKey:'real_estate',categoryVersion:3,...overrides.tenant},membership:{id:'member-a',tenantId,role:'owner',status:'active',...overrides.membership},category,subscription:{status:'active',capabilities:[...category.capabilities]},...overrides}; }
const row={id:'property-a',referenceCode:'RE-AAA',titleEn:'Harbour apartment',titleAr:'شقة الميناء',propertyType:'apartment',transactionType:'rent',priceMinor:850000,currency:'QAR',areaSqm:95,bedrooms:2,city:'Doha',descriptionEn:'Close to the waterfront.',descriptionAr:'قريبة من الواجهة البحرية.'};
const property={...row,kind:'property'};

test('real-estate domain pack is versioned and exposes tenant-editable bilingual replies and display controls',()=>{
  assert.equal(pack.key,'real_estate');assert.equal(pack.version,3);assert.ok(pack.guidedContentSchema.groups.some(group=>group.id==='property-display'));
  const saved=botInput({name:'Property guide',engine:'guided',config:{guidedContent:{messages:{welcome:{en:'Welcome to our listings.',ar:'مرحباً بقوائمنا.'},priceLabel:{en:'Asking rent',ar:'الإيجار المطلوب'}},display:{maxProperties:3,showPrices:false}}}},'real_estate',3);
  assert.equal(saved.config.guidedContent.messages.welcome.en,'Welcome to our listings.');assert.equal(saved.config.guidedContent.display.maxProperties,3);assert.equal(saved.config.guidedContent.display.showPrices,false);
});

test('real-estate bot facts query only active listings for the authenticated tenant and honor module disablement',async()=>{
  const queries=[],db={query:async(sql,args)=>{queries.push({sql,args});return [[row]];}};
  const facts=await pack.loadFacts({db,tenantId,context:context()});
  assert.equal(facts.length,1);assert.equal(facts[0].referenceCode,'RE-AAA');assert.deepEqual(queries[0].args,[tenantId]);
  assert.match(queries[0].sql,/tenant_id=\? AND status='active'/);
  assert.deepEqual(await pack.loadFacts({db,tenantId,context:context({tenant:{disabledModules:['realestate.listings']}})}),[]);
  assert.deepEqual(await pack.loadFacts({db,tenantId:'tenant-foreign',context:context()}),[]);
  assert.equal(queries.length,1);
});

test('real-estate guide localizes replies, hides configured fields, never invents availability, and offers human help',()=>{
  const copy={messages:{welcome:{en:'Welcome to our listings.',ar:'مرحباً بقوائمنا.'},listPrompt:{en:'Current listings:',ar:'العقارات الحالية:'},priceLabel:{en:'Asking rent',ar:'الإيجار المطلوب'},detailPrompt:{en:'Ask us about this listing.',ar:'اسألنا عن هذا العقار.'}},display:{maxProperties:2,showPrices:false,showArea:true,showBedrooms:true}};
  const welcome=pack.guidedReply({message:'مرحبا',facts:[property],config:copy});assert.match(welcome.reply,/مرحباً بقوائمنا/);
  const list=pack.guidedReply({message:'show apartments for rent',facts:[property],config:copy});assert.match(list.reply,/Harbour apartment/);assert.match(list.reply,/Doha/);assert.doesNotMatch(list.reply,/850,000|QAR/);assert.match(list.reply,/95/);
  const detail=pack.guidedReply({message:'RE-AAA',facts:[property],config:copy});assert.match(detail.reply,/Close to the waterfront/);assert.doesNotMatch(detail.reply,/available for viewing/);
  const handoff=pack.guidedReply({message:'talk to a person',facts:[property],config:copy});assert.equal(handoff.handoff,true);
  const empty=pack.guidedReply({message:'show listings',facts:[],config:copy});assert.match(empty.reply,/team can help/i);
});

test('AI context retrieval includes matching property evidence without exposing another domain record',()=>{
  const {retrieveContext,validateAnswer}=require('../modules/platform/chatbot-business-context');
  const result=retrieveContext({facts:[{...row,kind:'property'}],message:'Tell me about Harbour apartment',knowledgeEntries:[]});
  assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].kind,'property');assert.equal(result.evidence[0].referenceCode,'RE-AAA');
  assert.deepEqual(validateAnswer({canAnswer:true,reply:'The listed price is QAR 8,500.00.',sourceIds:['property:RE-AAA']},result),{valid:true});
  assert.deepEqual(validateAnswer({canAnswer:true,reply:'السعر المعروض ٨٬٥٠٠٫٠٠ ر.ق',sourceIds:['property:RE-AAA']},result),{valid:true});
  assert.equal(validateAnswer({canAnswer:true,reply:'The listed price is QAR 9,200.00.',sourceIds:['property:RE-AAA']},result).code,'ANSWER_PRICE_INVALID');
  const broad=retrieveContext({facts:[{...row,kind:'property'}],message:'show listings',knowledgeEntries:[]});assert.ok(broad.evidence.some(item=>item.kind==='property'));
  const unrelated=retrieveContext({facts:[{...row,kind:'property'}],message:'What is your refund policy?',knowledgeEntries:[]});assert.equal(unrelated.evidence.length,0);
});
