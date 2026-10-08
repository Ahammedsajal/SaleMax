'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const signature=require('../modules/platform/meta-webhook-signature');
const root=path.join(__dirname,'..');

test('Meta webhook signatures are checked against the exact raw request body',()=>{
  const body=Buffer.from('{"entry":[{"changes":[]}]}'),secret='synthetic-meta-app-secret',digest=crypto.createHmac('sha256',secret).update(body).digest('hex');
  assert.equal(signature.verifySignature(body,`sha256=${digest}`,secret),true);
  assert.equal(signature.verifySignature(Buffer.from(body.toString()+' '),`sha256=${digest}`,secret),false);
  assert.equal(signature.verifySignature(body,`sha256=${'0'.repeat(64)}`,secret),false);
  assert.equal(signature.verifySignature(body,`sha1=${digest}`,secret),false);
  assert.equal(signature.verifySignature(body,null,secret),false);
  assert.equal(signature.verifySignature(body,`sha256=${digest}`,''),false);
  assert.equal(signature.verifySignature(body,`sha256=${digest}`,null),false);
});

test('raw-body capture is limited to the two existing Meta webhook routes',()=>{
  const raw=Buffer.from('{}'),other=Buffer.from('{"large":"payload"}');
  for(const url of ['/api/inbox/webhook/account','/api/inbox/embed/webhook/account']){
    const req={originalUrl:url};signature.captureRawBody(req,null,raw);assert.equal(req.rawBody,raw);
  }
  const req={originalUrl:'/api/user/save-profile'};signature.captureRawBody(req,null,other);assert.equal(req.rawBody,undefined);
});

test('both production app entrypoints capture webhook bytes and routes reject unsigned callbacks before processing',()=>{
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),server=fs.readFileSync(path.join(root,'server.js'),'utf8'),inbox=fs.readFileSync(path.join(root,'routes/inbox.js'),'utf8');
  for(const source of [app,server])assert.match(source,/express\.json\(\{ limit: ["']10mb["'], verify: require\(["']\.\/modules\/platform\/meta-webhook-signature["']\)\.captureRawBody \}\)/);
  for(const route of ['/embed/webhook/:uid','/webhook/:uid']){
    const index=inbox.indexOf(`router.post("${route}"`);assert.ok(index>=0);
    const handler=inbox.slice(index,index+500);assert.ok(handler.indexOf('verifyMetaWebhookRequest(req, res)')<handler.indexOf('const body = req.body'));
  }
  assert.match(inbox,/META_WEBHOOK_SIGNATURE_NOT_CONFIGURED/);assert.match(inbox,/INVALID_META_WEBHOOK_SIGNATURE/);
  assert.doesNotMatch(inbox,/console\.log\(JSON\.stringify\(\{ body \}\)\)/);
});
