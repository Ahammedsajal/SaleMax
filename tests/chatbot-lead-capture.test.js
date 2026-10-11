'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerName, qualificationFromText, addQuestion } = require('../modules/platform/chatbot-lead-capture');
const { coursePdfs } = require('../modules/platform/chatbot-course-media');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
test('English and Arabic names are captured from declarations or a requested name response',()=>{
  assert.equal(customerName('My name is Adam Saleh and I want Advanced Excel.'),'Adam Saleh');
  assert.equal(customerName('اسمي أحمد علي وأريد دورة Excel'),'أحمد علي');
  assert.equal(customerName('Adam Saleh',true),'Adam Saleh');
  assert.equal(customerName('أحمد علي',true),'أحمد علي');
  assert.equal(customerName('Adam Saleh'),null);
  for(const text of ['How much','Good evening','I am interested in nursing','Advanced Excel','yes please','more','details','97450000001','My name is '+ 'word '.repeat(9)]) assert.equal(customerName(text,true),null);
});
test('useful contact preferences are captured without asking for identity or payment details',()=>{
 const data=qualificationFromText('I want to improve reporting. Weekend classes please. My email is learner@example.invalid');
 assert.equal(data.email,'learner@example.invalid');assert.equal(data.learningGoal,'improve reporting');assert.match(data.preferredSchedule,/Weekend/);
 assert.deepEqual(qualificationFromText('Hi'),{});
 assert.equal(qualificationFromText('Is your email info@example.invalid?').email,undefined);
 assert.equal(qualificationFromText('I am interested in English').courseInterest,'English');
});
test('lead prompt replaces a generic last question and is editable in both languages',()=>{
 const defaults=getDomainPack('training_center',1).guidedContentDefaults;
 assert.equal(addQuestion('Excel is QAR 950. Would you like more details?',{questionKey:'collectNameMessage',language:'en'},{},defaults),'Excel is QAR 950.\n\nMay I have your name?');
 assert.equal(addQuestion('أهلاً!',{questionKey:'collectNameMessage',language:'ar'},{guidedContent:{messages:{collectNameMessage:{ar:'ما اسم المتعلم؟'}}}},defaults),'أهلاً!\n\nما اسم المتعلم؟');
 assert.equal(addQuestion('Hello',null,{},defaults),'Hello');
});
test('only the selected course PDF is shared once, with explicit requests allowing another copy',()=>{
 const facts=[{code:'EXCEL',courseId:'course-a',media:[{id:'pdf-a',kind:'document',mimeType:'application/pdf'},{id:'other',kind:'document',mimeType:'application/msword'}]},{code:'CARE',courseId:'course-b',media:[{id:'pdf-b',kind:'document',mimeType:'application/pdf'}]}];
 assert.equal(coursePdfs(facts,'EXCEL','How much?')[0].id,'pdf-a');
 assert.equal(coursePdfs(facts,'EXCEL','more',['pdf-a']).length,0);
 assert.equal(coursePdfs(facts,'EXCEL','Please send PDF',['pdf-a'])[0].courseId,'course-a');
 assert.equal(coursePdfs(facts,null,'details').length,0);
});
