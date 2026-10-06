'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('registration capture and A4 print place Business Profile name and logo inside the form',()=>{
  let printed='';
  const popup={document:{open(){},write(value){printed=value;},close(){}}};
  const window={open:()=>popup};
  const source=fs.readFileSync(path.join(__dirname,'../client/public/training-registration.js'),'utf8');
  vm.runInNewContext(source,{window,URL,location:{origin:'https://crm.example.invalid'}});
  const profile={centerNameEn:'Example Training Center',centerNameAr:'مركز التدريب',logoUrl:'/media/example-logo.png'};
  const schema={fields:[],consentTextEn:'Agreement',consentTextAr:'الاتفاقية'};
  const capture=window.SXTrainingRegistration.capture(schema,'en',false,profile);
  assert.match(capture,/REGISTRATION FORM/);
  assert.match(capture,/Example Training Center/);
  assert.match(capture,/class="reg-center-logo" src="https:\/\/crm\.example\.invalid\/media\/example-logo\.png"/);
  assert.equal(window.SXTrainingRegistration.print({contact_name:'Learner'},{businessProfile:{...profile,nameEn:profile.centerNameEn}}),true);
  assert.match(printed,/@page\{size:A4 portrait/);
  assert.match(printed,/Example Training Center/);
  assert.match(printed,/https:\/\/crm\.example\.invalid\/media\/example-logo\.png/);
});
