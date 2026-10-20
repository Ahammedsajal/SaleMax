'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const forms=require('../modules/platform/chatbot-capture-forms'),plans=require('../modules/platform/plans'),{trainingCenter,salemaxSales}=require('../modules/platform/categories'),{botInput}=require('../modules/platform/chatbot-config');
const id='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const ctx={tenant:{id:'tenant-a'},category:trainingCenter,subscription:{status:'active',categoryKey:'training_center',categoryVersion:1,capabilities:['portal.forms']}};
test('per-bot form configuration preserves automatic selection and distinguishes an explicit disabled link',()=>{
 const input={name:'Synthetic bot',engine:'guided',config:{guidedMode:'domain_default'}};
 assert.equal(Object.hasOwn(botInput(input,'training_center').config,'captureFormId'),false);
 for(const value of [null,id])assert.equal(botInput({...input,config:{...input.config,captureFormId:value}},'training_center').config.captureFormId,value);
 for(const value of ['',{},'------------------------------------','https://foreign.invalid/'])assert.throws(()=>forms.normalize(value),{code:'INVALID_CAPTURE_FORM'});
 assert.throws(()=>botInput({...input,config:{captureFormId:id}},salemaxSales.key),{code:'INVALID_CAPTURE_FORM'});
});
test('form options and validation are tenant-bound, current and entitlement-restricted',async()=>{
 const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return [args.length===1||args[1]===id?[{formId:id,nameEn:'Form A',nameAr:'نموذج أ',publishedVersion:2,customFieldCount:3}]:[]];}};
 assert.deepEqual(await forms.options(db,ctx),[{id,nameEn:'Form A',nameAr:'نموذج أ',publishedVersion:2,customFieldCount:3}]);await forms.validate(db,ctx,{captureFormId:id});
 assert.match(calls[1].sql,/v.tenant_id=f.tenant_id/);assert.match(calls[1].sql,/f.tenant_id=\?/);assert.match(calls[1].sql,/f.id=\?/);assert.deepEqual(calls[1].args,['tenant-a',id]);
 await assert.rejects(forms.validate(db,ctx,{captureFormId:foreign}),{code:'CAPTURE_FORM_UNAVAILABLE'});
 assert.deepEqual(await forms.options(db,{...ctx,subscription:{...ctx.subscription,status:'expired'}}),[]);
 await assert.rejects(forms.validate(db,{...ctx,subscription:{...ctx.subscription,categoryVersion:2}},{captureFormId:id}),{code:'FEATURE_UNAVAILABLE'});
 await forms.validate(db,ctx,{captureFormId:null});await forms.validate(db,ctx,{});
});
test('runtime selected form uses current plan and never substitutes a different form',async()=>{
 const original=plans.loadEntitlements;plans.loadEntitlements=async()=>ctx.subscription;let calls=0;const db={query:async(sql,args)=>{calls++;assert.deepEqual(args,['tenant-a',id]);return [[]];}};
 try{assert.deepEqual(await forms.selectedRows(db,'tenant-a',id),[]);assert.equal(calls,1);assert.deepEqual(await forms.selectedRows(db,'tenant-a',null),[]);plans.loadEntitlements=async()=>null;assert.deepEqual(await forms.selectedRows(db,'tenant-a',id),[]);assert.equal(calls,1);}finally{plans.loadEntitlements=original;}
});
