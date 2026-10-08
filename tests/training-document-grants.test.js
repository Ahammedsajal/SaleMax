'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const grants=require('../modules/platform/training-document-grants');
test('customer link tokens have high entropy and only valid 32-byte base64url tokens are accepted',()=>{
  const raw=Buffer.alloc(32,7).toString('base64url');
  assert.match(raw,/^[A-Za-z0-9_-]{43}$/);
  assert.match(grants.tokenHash(raw),/^[a-f0-9]{64}$/);
  assert.notEqual(grants.tokenHash(raw),raw);
  for(const bad of ['', 'a'.repeat(42), '*'.repeat(43), `${raw}=`, null])assert.throws(()=>grants.tokenHash(bad),{code:'DOCUMENT_LINK_INVALID'});
});
test('customer link expiry is bounded to seven days and recipient display is masked',()=>{
  assert.equal(grants.TTL_MS,7*24*60*60*1000);
  assert.equal(grants.maskEmail('student@example.qa'),'s•••@example.qa');
  assert.equal(grants.maskEmail('a@example.qa'),'a•••@example.qa');
  assert.throws(()=>grants.maskEmail('invalid'),{code:'DOCUMENT_RECIPIENT_UNAVAILABLE'});
});
test('forward migration stores only token and recipient hashes and preserves revoke/expiry indexes',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../database/migrations/20261121_training_document_grants.sql'),'utf8');
  assert.match(sql,/token_hash CHAR\(64\)/);assert.match(sql,/recipient_hash CHAR\(64\)/);assert.match(sql,/snapshot_hash CHAR\(64\)/);
  assert.match(sql,/expires_at DATETIME\(3\)/);assert.match(sql,/revoked_at DATETIME\(3\)/);assert.match(sql,/document_type ENUM\('invoice','receipt'\)/);
  assert.doesNotMatch(sql,/token VARCHAR|recipient_email|DROP TABLE/i);
});
function context(role='owner',tenantId='tenant-a'){return {audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-a',tenantId,status:'active',role},identity:{id:'identity-a'},category:{key:'training_center',version:1,capabilities:['finance.invoices','finance.receipts']},subscription:{status:'active',capabilities:['finance.invoices','finance.receipts']}};}
function database(){
  const grantsRows=[];let snapshotSuffix='';
  const invoice={id:'invoice-a',tenant_id:'tenant-a',status:'issued',invoice_number:'TC-2026-000001',currency:'QAR',legal_name_snapshot:'Training LLC',legal_registration_snapshot:'CR-123',legal_address_snapshot:'Doha',subtotal_minor:10000,tax_minor:0,total_minor:10000,invoice_email:'student@example.qa',issued_at:'2026-10-01T10:00:00.000Z',terms_snapshot:'Agreed terms',enrollment_id:'enrollment-a'};
  const db={grantsRows,setSnapshotSuffix(value){snapshotSuffix=value;},async beginTransaction(){},async commit(){},async rollback(){},async query(sql,params=[]){
    if(sql.includes('FROM sx_training_invoices WHERE tenant_id=? AND id=?'))return [[params[0]==='tenant-a'?invoice:null].filter(Boolean)];
    if(sql.includes('FROM sx_training_enrollments WHERE tenant_id=?'))return [[{learner_name:'Learner',payer_name:'Payer'}]];
    if(sql.includes('FROM sx_training_invoice_lines WHERE tenant_id=?'))return [[{line_number:1,description_en:'Course',description_ar:'دورة',quantity:1,unit_amount_minor:10000,discount_minor:0,tax_minor:0,total_minor:10000}]];
    if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:params[0]}]];
    if(sql.startsWith('UPDATE sx_training_document_grants SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND document_type=?')){let count=0;for(const row of grantsRows){if(row.tenant===params[0]&&row.type===params[1]&&row.document===params[2]&&row.revokedAt===null){row.revokedAt=new Date();count++;}}return [{affectedRows:count}];}
    if(sql.startsWith('INSERT INTO sx_training_document_grants')){grantsRows.push({id:params[0],tenant:params[1],type:params[2],document:params[3],tokenHash:params[4],recipientHash:params[5],snapshotHash:params[6],expiresAt:params[7],revokedAt:null});return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
    if(sql.includes('FROM sx_training_document_grants WHERE token_hash=?')){const row=grantsRows.find(item=>item.tokenHash===params[0]&&item.revokedAt===null&&new Date(item.expiresAt)>new Date());return [[row?{tenant_id:row.tenant,document_type:row.type,document_id:row.document,snapshot_hash:row.snapshotHash}:null].filter(Boolean)];}
    if(sql.includes('SELECT i.total_minor,COALESCE'))return [[{total_minor:10000,allocated:2500,credited:500,as_of:'2026-10-08T10:00:00.000Z'}]];
    throw Error(`Unexpected SQL in test: ${sql}`);
  }};
  return db;
}
test('issue, resolve, rotate and revoke a customer link without storing or returning the raw token again',async()=>{
  const db=database(),ctx=context(),first=await grants.issue(db,ctx,'invoice','invoice-a',{origin:'https://crm.example.qa',now:Date.now()}),token=new URL(first.url).hash.slice(1);
  assert.equal(first.recipient,'s•••@example.qa');assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(db.grantsRows[0].tokenHash,grants.tokenHash(token));assert.ok(!JSON.stringify(db.grantsRows[0]).includes(token));
  const resolved=await grants.resolve(db,token);assert.equal(resolved.number,'TC-2026-000001');assert.equal(resolved.balance.amountDueMinor,7000);assert.ok(resolved.balance.asOf);
  const second=await grants.issue(db,ctx,'invoice','invoice-a',{origin:'https://crm.example.qa'});assert.equal(db.grantsRows[0].revokedAt instanceof Date,true);await assert.rejects(grants.resolve(db,token),{code:'DOCUMENT_LINK_UNAVAILABLE'});
  const secondToken=new URL(second.url).hash.slice(1);assert.equal((await grants.resolve(db,secondToken)).type,'invoice');
  await grants.revoke(db,ctx,'invoice','invoice-a');await assert.rejects(grants.resolve(db,secondToken),{code:'DOCUMENT_LINK_UNAVAILABLE'});
});
test('customer document access rejects an unauthorized role and malformed or tampered tokens',async()=>{
  const db=database();await assert.rejects(grants.issue(db,context('manager'),'invoice','invoice-a',{origin:'https://crm.example.qa'}),{code:'PERMISSION_DENIED'});
  await assert.rejects(grants.issue(db,context('owner','tenant-b'),'invoice','invoice-a',{origin:'https://crm.example.qa'}),{code:'DOCUMENT_NOT_FOUND'});
  await assert.rejects(grants.resolve(db,'not-a-token'),{code:'DOCUMENT_LINK_INVALID'});
  const issued=await grants.issue(db,context(),'invoice','invoice-a',{origin:'https://crm.example.qa'}),token=new URL(issued.url).hash.slice(1);
  await assert.rejects(grants.resolve(db,`${token.slice(0,-1)}${token.endsWith('A')?'B':'A'}`),{code:'DOCUMENT_LINK_UNAVAILABLE'});
  db.grantsRows[0].expiresAt=new Date(Date.now()-1000);await assert.rejects(grants.resolve(db,token),{code:'DOCUMENT_LINK_UNAVAILABLE'});
});
test('customer document route and existing Finance screen use same-origin, fragment-only, no-store links',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const router=read('modules/platform/training-finance-router.js'),mount=read('modules/platform/mount-existing-upgrade.js'),screen=read('client/public/training-finance.js'),page=read('client/public/customer-document.html'),script=read('client/public/customer-document.js');
  assert.match(router,/\/documents\/:type\/:id\/link/);assert.match(router,/\/resolve/);assert.match(router,/Referrer-Policy/);assert.match(router,/req\.get\('Origin'\)!==origin/);
  assert.match(mount,/\/api\/public\/training\/documents/);assert.match(mount,/Content-Security-Policy/);assert.match(mount,/Referrer-Policy/);
  assert.match(screen,/Create customer link/);assert.match(screen,/Revoke customer links/);assert.match(screen,/url\.hash/);
  assert.match(page,/customer-document\.js/);assert.doesNotMatch(page,/<script[^>]+src="https?:/i);
  assert.match(script,/location\.hash/);assert.match(script,/history\.replaceState/);assert.match(script,/credentials:'omit'/);assert.match(script,/referrerPolicy:'no-referrer'/);
});
