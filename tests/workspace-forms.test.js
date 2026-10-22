'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const forms=require('../modules/platform/workspace-forms');
const {capabilities}=require('../modules/platform/policy');
const base=require('../modules/platform/categories').baseCrm;
const {createCategoryRegistry}=require('../modules/platform/category-registry');
const category=createCategoryRegistry([{...base,capabilities:[...base.capabilities,'portal.forms'],formsAdapter:'generic-lead-capture-v1'}],capabilities).get(base.key,base.version);
const ctx={audience:'tenant',identity:{id:'identity-1'},tenant:{id:'tenant-1',status:'active',categoryKey:base.key,categoryVersion:base.version},membership:{id:'membership-1',tenantId:'tenant-1',role:'owner',status:'active'},category,subscription:{status:'active',capabilities:[...category.capabilities]}};
const input={slug:'contact-request',nameEn:'Contact request',nameAr:'طلب تواصل',schema:{titleEn:'Contact us',titleAr:'تواصل معنا',descriptionEn:'Tell us how to reach you.',descriptionAr:'أخبرنا كيف نتواصل معك.',consentTextEn:'I agree to be contacted.',consentTextAr:'أوافق على التواصل معي.',fields:[{key:'contact_name',labelEn:'Name',labelAr:'الاسم',required:true},{key:'phone',labelEn:'Phone',labelAr:'الهاتف',required:true},{key:'email',labelEn:'Email',labelAr:'البريد الإلكتروني',required:false},{key:'consent',labelEn:'Contact consent',labelAr:'الموافقة على التواصل',required:true}]}};
function fakeDb({formRow=null}={}){
  const calls=[];const db={calls,formRow,async beginTransaction(){calls.push({sql:'BEGIN'});},async commit(){calls.push({sql:'COMMIT'});},async rollback(){calls.push({sql:'ROLLBACK'});},async query(sql,params){calls.push({sql,params});if(sql.includes('FROM sx_workspace_forms WHERE tenant_id=? AND id=? FOR UPDATE'))return [[db.formRow].filter(Boolean)];return [[]];}};return db;
}
test('generic Forms require the exact declared adapter, category capability, tenant and plan access',()=>{
  assert.equal(forms.context(ctx),'generic-lead-capture-v1');
  assert.throws(()=>forms.context({...ctx,category:base}),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>forms.context({...ctx,subscription:{status:'active',capabilities:[]}}),{code:'FEATURE_UNAVAILABLE'});
  assert.throws(()=>forms.context({...ctx,membership:{...ctx.membership,tenantId:'tenant-2'}}),{code:'TENANT_CONTEXT_REQUIRED'});
});
test('shared Forms router selects the generic service only for its declared category adapter',()=>{
  const route=require('../modules/platform/training-form-router');
  assert.equal(route.formsServiceForCategory(category),forms);
  assert.notEqual(route.formsServiceForCategory(base),forms);
  assert.equal(route.formsServiceForCategory(base),require('../modules/platform/training-forms'));
  assert.equal(route.formsServiceForCategory(trainingCategory()),require('../modules/platform/training-forms'));
});
function trainingCategory(){return require('../modules/platform/categories').trainingCenter;}
test('generic draft create and update use isolated workspace tables and tenant predicates',async()=>{
  const db=fakeDb(),created=await forms.create(db,ctx,input);
  assert.equal(created.status,'draft');assert.equal(created.draftRevision,1);
  const insert=db.calls.find(call=>call.sql.startsWith('INSERT INTO sx_workspace_forms'));
  assert.ok(insert);assert.equal(insert.params[1],ctx.tenant.id);assert.equal(JSON.parse(insert.params[5]).templateKey,null);
  db.formRow={draft_revision:1,published_version:null};
  const updated=await forms.update(db,ctx,created.id,1,{...input,nameEn:'Contact request updated'});
  assert.equal(updated.draftRevision,2);assert.ok(db.calls.some(call=>call.sql.includes('WHERE tenant_id=? AND id=?')&&call.params.includes(ctx.tenant.id)));
  assert.ok(db.calls.some(call=>call.sql.includes("'workspace.form-created'")));
});
test('generic publishing appends immutable versions and rejects stale draft revisions',async()=>{
  const schema=require('../modules/platform/training-forms').formInput(input,'generic-lead-capture-v1').schema;
  const db=fakeDb({formRow:{slug:input.slug,name_en:input.nameEn,name_ar:input.nameAr,draft_schema:JSON.stringify(schema),draft_revision:3,published_version:null,published_draft_revision:null}});
  const published=await forms.publish(db,ctx,'11111111-1111-4111-8111-111111111111',3);
  assert.equal(published.version,1);assert.ok(db.calls.some(call=>call.sql.startsWith('INSERT INTO sx_workspace_form_versions')));assert.ok(db.calls.some(call=>call.sql.startsWith('UPDATE sx_workspace_forms')));
  const stale=fakeDb({formRow:{slug:input.slug,name_en:input.nameEn,name_ar:input.nameAr,draft_schema:JSON.stringify(schema),draft_revision:4,published_version:null,published_draft_revision:null}});
  await assert.rejects(forms.publish(stale,ctx,'11111111-1111-4111-8111-111111111111',3),{code:'STALE_REVISION'});assert.ok(stale.calls.some(call=>call.sql==='ROLLBACK'));
});
test('generic submission listing always scopes count and records to the current tenant',async()=>{
  const db=fakeDb();db.query=async(sql,params)=>{db.calls.push({sql,params});if(sql.includes('COUNT(*) total'))return [[{total:0}]];if(sql.includes('FROM sx_workspace_form_submissions s'))return [[]];return [[]];};
  const result=await forms.submissions(db,ctx,{search:'lead',from:'2026-10-01',to:'2026-10-22'});
  assert.equal(result.total,0);assert.equal(result.page,1);assert.equal(db.calls.filter(call=>call.sql.includes('sx_workspace_form_submissions')).every(call=>call.params.includes(ctx.tenant.id)),true);
  await assert.rejects(forms.submissions(db,ctx,{from:'2026-10-22',to:'2026-10-01'}),{code:'INVALID_DATE_RANGE'});
});
