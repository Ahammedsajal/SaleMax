const test = require('node:test');
const assert = require('node:assert/strict');
const {normalize, createHandlers, columns} = require('../modules/platform/legacy-plan-editor');
const valid = () => ({id:'7',title:' Training ',short_description:' Centre ',price:'250',price_strike:'300.50',plan_duration_in_days:'30',contact_limit:'1000',qr_account:'2',allow_tag:'0',allow_chatbot:true,is_trial:false});
test('existing catalogue input preserves explicit disabled flags and integer commercial limits',()=>{
  const result=normalize(valid(),true);
  assert.deepEqual(result.errors,{});
  assert.equal(result.value.title,'Training');
  assert.equal(result.value.allow_tag,0);
  assert.equal(result.value.allow_chatbot,1);
  assert.equal(result.value.price,250);
  assert.equal(result.value.price_strike,300.5);
  assert.equal(normalize({...valid(),is_trial:'1'},true).value.price,0);
  for(const [field,values] of Object.entries({id:[0,1.5,true,'7x'],plan_duration_in_days:[0,'1.5',true,'30days',''],qr_account:[-1,'2.8',{},2147483648],contact_limit:[-1,'3.5',[]],allow_tag:['false','true',2],title:[{},' ',100],price:['1.50',-1,true,'NaN','1e4']})) {
    for(const value of values) assert.ok(normalize({...valid(),[field]:value},true).errors[field],`${field} accepted ${String(value)}`);
  }
});
test('invalid catalogue requests never issue writes and missing plans remain missing',async()=>{
  let calls=0;
  const handlers=createHandlers(async()=>{calls++;return []});
  let response;
  const res={json:value=>{response=value;}};
  await handlers.add({body:{...valid(),qr_account:'2.5'}},res);
  assert.equal(response.code,'INVALID_PLAN');assert.equal(calls,0);
  await handlers.edit({body:valid()},res);
  assert.equal(response.code,'PLAN_NOT_FOUND');assert.equal(calls,1);
});
test('existing create/edit handlers retain plan IDs, parameterized values and safe database failures',async()=>{
  const calls=[];
  const handlers=createHandlers(async(sql,args)=>{calls.push([sql,args]);return [{id:7}];});
  let response;const res={json:value=>{response=value;}};
  await handlers.add({body:valid()},res);assert.equal(response.success,true);
  assert.ok(calls[0][0].startsWith('INSERT INTO plan'));
  assert.equal(calls[0][1].length,columns.length);
  await handlers.edit({body:valid()},res);assert.equal(response.success,true);
  assert.equal(calls[2][1].at(-1),7);
  const failed=createHandlers(async()=>{throw new Error('private database details');});
  await failed.add({body:valid()},res);assert.equal(response.code,'PLAN_SAVE_FAILED');
  assert.ok(!JSON.stringify(response).includes('private'));
});
