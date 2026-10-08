'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const prefs=require('../modules/platform/training-reminder-preferences');

test('reminder preference link tokens are canonical 256-bit base64url and only hashes are persisted',()=>{
  const token=Buffer.alloc(32,9).toString('base64url');assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.match(prefs.tokenHash(token),/^[a-f0-9]{64}$/);assert.notEqual(prefs.tokenHash(token),token);
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',last=alphabet.indexOf(token.at(-1)),alternate=alphabet[(last&48)|((last+1)&15)];
  for(const bad of ['',null,'x'.repeat(43),`${token}=`,`${token.slice(0,-1)}${alternate}`])assert.throws(()=>prefs.tokenHash(bad),{code:'REMINDER_LINK_UNAVAILABLE'});
  assert.equal(prefs.maskEmail('student@example.qa'),'s•••@example.qa');assert.equal(prefs.maskEmail('invalid'),null);
});

test('preference token can be encrypted for reminder unsubscribe links without storing the raw bearer token',()=>{
  const env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,4).toString('base64')},token=Buffer.alloc(32,8).toString('base64url'),sealed=prefs.encryptToken(token,env);assert.equal(prefs.decryptToken({token_hash:sealed.tokenHash,token_ciphertext:sealed.ciphertext,token_iv:sealed.iv,token_tag:sealed.tag},env),token);assert.notEqual(sealed.ciphertext.toString('utf8'),token);assert.throws(()=>prefs.decryptToken({token_hash:sealed.tokenHash,token_ciphertext:sealed.ciphertext,token_iv:sealed.iv,token_tag:sealed.tag},{SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,5).toString('base64')}),{code:'REMINDER_LINK_UNAVAILABLE'});
});

test('only active training-center owner/accountant with invoice access can issue a preference link',async()=>{
  const ctx={audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId:'tenant-a',status:'active',role:'manager'},identity:{id:'identity-a'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}};
  await assert.rejects(prefs.issue({query(){throw Error('database should not be touched')}},ctx,'00000000-0000-4000-8000-000000000001',{origin:'https://crm.example.qa'}),{code:'PERMISSION_DENIED'});
});

test('Finance can issue a one-time encrypted preference token without changing existing consent',async()=>{
  const tenantId='tenant-a',invoiceId='00000000-0000-4000-8000-000000000001',env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,6).toString('base64')},writes=[];
  const db={async beginTransaction(){},async commit(){},async rollback(){},async query(sql,params){if(sql.includes('SELECT id,invoice_email FROM sx_training_invoices'))return [[{id:invoiceId,invoice_email:'payer@example.qa'}]];if(sql.includes('SELECT id,status,recipient_hash FROM sx_training_reminder_preferences'))return [[]];writes.push({sql,params});return [{affectedRows:1}];}};
  const result=await prefs.issue(db,{audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId,status:'active',role:'owner'},identity:{id:'identity-a'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}},invoiceId,{origin:'https://crm.example.qa/path',env});
  const token=new URL(result.url).hash.slice(1),insert=writes.find(x=>x.sql.includes('INSERT INTO sx_training_reminder_preferences')),sealed={token_hash:insert.params[3],token_ciphertext:insert.params[4],token_iv:insert.params[5],token_tag:insert.params[6]};assert.equal(new URL(result.url).origin,'https://crm.example.qa');assert.equal(new URL(result.url).pathname,'/customer-reminders');assert.equal(result.status,'pending');assert.equal(prefs.decryptToken(sealed,env),token);assert.ok(!JSON.stringify(insert.params).includes(token));
});

test('issuing a link preserves consent for the same recipient and resets it when the invoice recipient changes',async()=>{
  const invoiceId='00000000-0000-4000-8000-000000000001',tenantId='tenant-a',env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,7).toString('base64')};
  const hash=value=>require('node:crypto').createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  const run=async({email,existingHash,status})=>{let update,audit;const db={async beginTransaction(){},async commit(){},async rollback(){},async query(sql,params){if(sql.includes('SELECT id,invoice_email FROM sx_training_invoices'))return [[{id:invoiceId,invoice_email:email}]];if(sql.includes('SELECT id,status,recipient_hash FROM sx_training_reminder_preferences'))return [[{id:'preference-a',status,recipient_hash:existingHash}]];if(sql.startsWith('UPDATE sx_training_reminder_preferences'))update={sql,params};if(sql.includes('INSERT INTO sx_audit_events'))audit=params;return [{affectedRows:1}];}};const result=await prefs.issue(db,{audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId,status:'active',role:'owner'},identity:{id:'identity-a'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}},invoiceId,{origin:'https://crm.example.qa',env});return {result,update,audit};};
  const same=await run({email:'payer@example.qa',existingHash:hash('payer@example.qa'),status:'opted_in'});assert.equal(same.result.status,'opted_in');assert.equal(same.update.params[5],'opted_in');assert.equal(same.update.params[6],0);assert.equal(JSON.parse(same.audit[4]).consentReset,false);
  const changed=await run({email:'new-payer@example.qa',existingHash:hash('old-payer@example.qa'),status:'opted_in'});assert.equal(changed.result.status,'pending');assert.equal(changed.update.params[5],'pending');assert.deepEqual(changed.update.params.slice(6,9),[1,1,1]);assert.equal(JSON.parse(changed.audit[4]).consentReset,true);
});

test('customer opt-in and opt-out are explicit, transactional, and retain consent version evidence',async()=>{
  const token=Buffer.alloc(32,3).toString('base64url'),queries=[];let status='pending',committed=false;
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){},async query(sql,params){queries.push({sql,params});if(sql.includes('SELECT tenant_id,invoice_id FROM sx_training_reminder_preferences'))return [[{tenant_id:'tenant-a',invoice_id:'invoice-a'}]];if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:'tenant-a'}]];if(sql.includes('SELECT id FROM sx_training_invoices'))return [[{id:'invoice-a'}]];if(sql.includes('SELECT id,status FROM sx_training_reminder_preferences'))return [[{id:'preference-a',status}]];if(sql.startsWith('UPDATE sx_training_reminder_preferences')){status=params[0];return [{affectedRows:1}];}return [{affectedRows:1}];}};
  assert.deepEqual(await prefs.update(db,token,true),{status:'opted_in'});assert.equal(status,'opted_in');assert.equal(committed,true);assert.ok(queries.some(x=>x.sql.includes('consent_version')&&x.params[1]===prefs.CONSENT_VERSION));assert.ok(queries.some(x=>x.sql.includes("'system'")&&x.params[2]==='training.installment-reminders-opted-in'));
  committed=false;assert.deepEqual(await prefs.update(db,token,false),{status:'opted_out'});assert.equal(status,'opted_out');assert.equal(committed,true);assert.ok(queries.some(x=>x.sql.includes("'system'")&&x.params[2]==='training.installment-reminders-opted-out'));const auditCount=queries.filter(x=>x.sql.includes('INSERT INTO sx_audit_events')).length;await prefs.update(db,token,false);assert.equal(queries.filter(x=>x.sql.includes('INSERT INTO sx_audit_events')).length,auditCount);
  await assert.rejects(prefs.update(db,token,1),{code:'INVALID_REMINDER_PREFERENCE'});
});

test('migration stores no raw token or customer address and enforces one preference per issued invoice',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../database/migrations/20261122_training_reminder_preferences.sql'),'utf8');
  assert.match(sql,/UNIQUE KEY uq_training_reminder_preference_invoice \(tenant_id,invoice_id\)/);assert.match(sql,/token_hash CHAR\(64\)/);assert.match(sql,/token_ciphertext VARBINARY/);assert.match(sql,/token_iv BINARY\(12\)/);assert.match(sql,/token_tag BINARY\(16\)/);assert.match(sql,/recipient_hash CHAR\(64\)/);assert.match(sql,/status ENUM\('pending','opted_in','opted_out'\)/);assert.match(sql,/consent_version/);assert.match(sql,/consented_at/);assert.match(sql,/opted_out_at/);assert.doesNotMatch(sql,/token VARCHAR|recipient_email|DROP TABLE/i);
});

test('existing Finance invoice screen and customer preference page use the same origin and fragment token',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');const router=read('modules/platform/training-finance-router.js'),mount=read('modules/platform/mount-existing-upgrade.js'),screen=read('client/public/training-finance.js'),page=read('client/public/customer-reminders.html'),script=read('client/public/customer-reminders.js');
  assert.match(router,/reminder-preference-link/);assert.match(router,/createPublicTrainingReminderRouter/);assert.match(router,/req\.get\('Origin'\)!==origin/);assert.match(mount,/\/api\/public\/training\/reminder-preferences/);assert.match(mount,/\/customer-reminders/);assert.match(screen,/Create installment reminder preference link/);assert.match(screen,/\.pathname!=='\/customer-reminders'/);assert.match(page,/customer-reminders\.js/);assert.match(script,/location\.hash/);assert.match(script,/history\.replaceState/);assert.match(script,/credentials:'omit'/);assert.match(script,/referrerPolicy:'no-referrer'/);
});
