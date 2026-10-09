'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const { sendCourseMedia } = require('../modules/platform/chatbot-course-media');

test('course media is sent on selection or brochure request, without repeated attachments or media during handover', () => {
  const pack = getDomainPack('training_center',1);
  const facts = [{code:'SYNTHETIC',courseId:'course-a',nameEn:'Synthetic Program',media:[{id:'image-a',kind:'image'},{id:'pdf-a',kind:'document'},{id:'pdf-b',kind:'document'}]}];
  const first = pack.guidedReply({message:'Synthetic Program',facts});
  assert.deepEqual(first.media.map(item=>item.id),['image-a','pdf-a']);
  assert.equal(first.media[0].courseId,'course-a');
  const followup = pack.guidedReply({message:'more',state:first.state,facts});
  assert.equal(followup.media,undefined);
  for (const message of ['brochure','بروشور']) assert.equal(pack.guidedReply({message,state:first.state,facts}).media.length,2);
  assert.equal(pack.guidedReply({message:'agent',state:first.state,facts}).media,undefined);
});

test('attachment adapter enforces recipient, tenant course, pause and file limits before a QR send', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'salemax-course-media-'));
  const filePath = path.join(directory,'synthetic.pdf');
  const bytes = Buffer.from('%PDF-1.4\nSynthetic approved course fixture');
  await fs.writeFile(filePath,bytes);
  const sends=[]; const queries=[];
  let published=true;
  const pool={getConnection:async()=>({query:async(sql,params)=>{queries.push(params);return [published?[{id:'course-a'}]:[]];},release:()=>{}})};
  const input={pool,ctx:{tenant:{id:'tenant-a'}},profile:{config:{allowedRecipientPhones:['97450000001']}},uid:'owner-a',chatId:'chat-a',sessionId:'qr-a',message:{senderMobile:'97450000001'},origin:'qr',media:[{id:'media-a',courseId:'course-a'}],paused:async()=>false,getFile:async(db,tenantId,courseId,id)=>{assert.deepEqual([tenantId,courseId,id],['tenant-a','course-a','media-a']);return {kind:'document',mimeType:'application/pdf',originalName:'course.pdf',sizeBytes:bytes.length,path:filePath};},send:async message=>{sends.push(message);return 'synthetic-provider-id';}};
  try {
    assert.deepEqual(await sendCourseMedia(input),['synthetic-provider-id']);
    assert.deepEqual(queries[0],['tenant-a','course-a']);
    assert.equal(sends[0].recipient,'97450000001');
    assert.equal(sends[0].sessionId,'qr-a');
    assert.deepEqual(sends[0].content.document,bytes);
    sends.length=0;
    for(const override of [{message:{senderMobile:'97450000002'}},{paused:async()=>true},{origin:'meta'}]) assert.deepEqual(await sendCourseMedia({...input,...override}),[]);
    published=false;
    assert.deepEqual(await sendCourseMedia(input),[]);
    assert.equal(sends.length,0);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
