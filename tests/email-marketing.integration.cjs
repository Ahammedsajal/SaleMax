'use strict';

// Disposable local MySQL only. This test creates and drops a random synthetic database.
const mysql=require('mysql2/promise');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const provider=require('../modules/platform/email-marketing-provider-settings');
const ses=require('../modules/platform/email-marketing-ses');
const phonebook=require('../modules/platform/phonebook-workspace');
const {discover,splitSql}=require('../database/migration-runner');

async function main(){
  if(process.env.EMAIL_SYNTHETIC_ONLY!=='true')throw Error('SYNTHETIC_DATABASE_REQUIRED');
  const host=process.env.DBHOST||'127.0.0.1';
  if(!['127.0.0.1','localhost','::1'].includes(host))throw Error('LOCAL_DATABASE_REQUIRED');
  const dbName='salemax_email_test_'+crypto.randomBytes(6).toString('hex');
  const options={host,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER||'root',password:process.env.DBPASS||''};
  const admin=await mysql.createConnection(options);let db,pool;const originalGetAccount=ses.getAccount;
  try{
    await admin.query(`CREATE DATABASE \`${dbName}\``);
    pool=mysql.createPool({...options,database:dbName,connectionLimit:8});
    db=await pool.getConnection();
    for(const sql of [
      "CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,status VARCHAR(16) NOT NULL DEFAULT 'active') ENGINE=InnoDB",
      "CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB",
      'CREATE TABLE contact(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(191) NOT NULL,phonebook_id BIGINT UNSIGNED NOT NULL,phonebook_name VARCHAR(255) NOT NULL,name VARCHAR(999),mobile VARCHAR(100),var1 VARCHAR(999),var2 VARCHAR(999),var3 VARCHAR(999),var4 VARCHAR(999),var5 VARCHAR(999),var6 VARCHAR(999),createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB',
      'CREATE TABLE user(id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(191) NOT NULL,plan LONGTEXT,plan_expire VARCHAR(100)) ENGINE=InnoDB',
      'CREATE TABLE phonebook(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(191) NOT NULL,name VARCHAR(255) NOT NULL) ENGINE=InnoDB',
      'CREATE TABLE sx_audit_events(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_kind VARCHAR(32) NOT NULL,action VARCHAR(128) NOT NULL,resource_type VARCHAR(64) NOT NULL,resource_id VARCHAR(128) NOT NULL,changes JSON NOT NULL,correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB',
    ])await db.query(sql);
    const migrations=discover(path.join(__dirname,'../database/migrations'));
    const migration=migrations.find(item=>item.file==='20270106_email_marketing.sql');
    assert.ok(migration,'email migration must be discoverable');
    for(const sql of migration.statements)await db.query(sql);

    const identityId='11111111-1111-4111-8111-111111111111';
    const tenantId='22222222-2222-4222-8222-222222222222';
    await db.query('INSERT INTO sx_identities(id) VALUES(?)',[identityId]);
    await db.query('INSERT INTO sx_tenants(id) VALUES(?)',[tenantId]);
    const context={audience:'platform',mfaVerified:true,identity:{id:identityId},membership:{role:'super_admin',status:'active'}};
    const account={region:'eu-central-1',sendingEnabled:true,productionAccessEnabled:false,max24HourSend:200,maxSendRate:1,sentLast24Hours:0};
    ses.getAccount=async()=>account;
    const key=Buffer.alloc(32,19),accessOne='A'.repeat(20),secretOne='S'.repeat(40);
    const initial=await provider.save(db,key,context,{region:account.region,accessKeyId:accessOne,secretAccessKey:secretOne,expectedRevision:0});
    assert.equal(initial.revision,1);
    const [[stored]]=await db.query("SELECT access_key_ciphertext,secret_key_ciphertext FROM sx_platform_email_provider_settings WHERE provider_key='ses'");
    assert.notEqual(stored.access_key_ciphertext.toString('utf8'),accessOne);
    assert.notEqual(stored.secret_key_ciphertext.toString('utf8'),secretOne);
    const saved=await provider.read(db,key);assert.equal(saved.credentials.accessKeyId,accessOne);assert.equal(saved.credentials.secretAccessKey,secretOne);
    const publicStatus=await provider.status(db,key,context);
    assert.equal(publicStatus.account.sendingEnabled,true);
    assert.equal(JSON.stringify(publicStatus).includes(accessOne),false);
    assert.equal(JSON.stringify(publicStatus).includes(secretOne),false);

    const other=await pool.getConnection();
    try{
      let arrived=0,releaseGate;const gate=new Promise(resolve=>releaseGate=resolve);
      ses.getAccount=async()=>{if(++arrived===2)releaseGate();await gate;return account;};
      const updates=await Promise.allSettled([
        provider.save(db,key,context,{region:'eu-central-1',accessKeyId:'B'.repeat(20),secretAccessKey:'T'.repeat(40),expectedRevision:1}),
        provider.save(other,key,context,{region:'eu-central-1',accessKeyId:'C'.repeat(20),secretAccessKey:'U'.repeat(40),expectedRevision:1}),
      ]);
      assert.equal(updates.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(updates.filter(result=>result.status==='rejected'&&result.reason.code==='STALE_REVISION').length,1);
    }finally{other.release();}
    ses.getAccount=async()=>account;
    const [[revision]]=await db.query("SELECT revision FROM sx_platform_email_provider_settings WHERE provider_key='ses'");
    assert.equal(Number(revision.revision),2);
    const [[audit]]=await db.query("SELECT GROUP_CONCAT(changes SEPARATOR ' ') AS changes FROM sx_audit_events WHERE action='platform.email-ses.credentials-updated'");
    assert.equal(String(audit.changes).includes(accessOne),false);assert.equal(String(audit.changes).includes(secretOne),false);

    await db.query('INSERT INTO user(uid,plan,plan_expire) VALUES(?,?,?)',['sales-owner',JSON.stringify({contact_limit:100}),String(Date.now()+86400000)]);
    const [[user]]=await db.query('SELECT * FROM user WHERE uid=?',['sales-owner']);
    const [bookResult]=await db.query('INSERT INTO phonebook(uid,name) VALUES(?,?)',['sales-owner','Email prospects']);
    const ctx={uid:'sales-owner',hash:crypto.createHash('sha256').update('sales-owner').digest('hex'),manage:true,category:'7network_sales',emailMarketing:true,tenantId,identityId};
    const added=await phonebook.addContacts(db,ctx,{bookId:bookResult.insertId,manual:{name:'Synthetic Contact',mobile:'',email:'sales@example.invalid'},emailMarketingConsent:true});
    assert.deepEqual(added,{imported:1,withoutMobile:1});
    const listed=await phonebook.list(db,ctx,{});assert.equal(listed.rows[0].email,'sales@example.invalid');assert.equal(Number(listed.rows[0].email_marketing_consent),1);
    const contact=listed.rows[0];
    const editable={contactId:contact.id,name:contact.name,mobile:contact.mobile||'',var1:contact.var1||'',var2:contact.var2||'',var3:contact.var3||'',var4:contact.var4||'',var5:contact.var5||'',var6:contact.var6||'',email:contact.email,emailMarketingConsent:false};
    await phonebook.edit(db,ctx,editable);
    let [[savedContact]]=await db.query('SELECT email_marketing_consent,email_unsubscribed_at FROM contact WHERE id=?',[contact.id]);
    assert.equal(Number(savedContact.email_marketing_consent),0);assert.ok(savedContact.email_unsubscribed_at);
    let [[suppression]]=await db.query('SELECT reason FROM sx_email_suppressions WHERE tenant_id=? AND normalized_email=?',[tenantId,'sales@example.invalid']);
    assert.equal(suppression.reason,'unsubscribe');
    await phonebook.edit(db,ctx,{...editable,emailMarketingConsent:true});
    [[savedContact]]=await db.query('SELECT email_marketing_consent,email_unsubscribed_at FROM contact WHERE id=?',[contact.id]);
    assert.equal(Number(savedContact.email_marketing_consent),1);assert.equal(savedContact.email_unsubscribed_at,null);
    [[suppression]]=await db.query('SELECT reason FROM sx_email_suppressions WHERE tenant_id=? AND normalized_email=?',[tenantId,'sales@example.invalid']);
    assert.equal(suppression,undefined);
    const [[events]]=await db.query('SELECT COUNT(*) AS count,SUM(consented=1) AS optedIn,SUM(consented=0) AS optedOut FROM sx_email_consent_events WHERE tenant_id=? AND contact_id=?',[tenantId,contact.id]);
    assert.equal(Number(events.count),3);assert.equal(Number(events.optedIn),2);assert.equal(Number(events.optedOut),1);
    const restricted=await phonebook.list(db,{...ctx,emailMarketing:false},{});
    assert.equal(Object.hasOwn(restricted.rows[0],'email'),false);
    await assert.rejects(phonebook.list(db,{...ctx,emailMarketing:false},{filters:[{field:'email',value:'sales@example.invalid'}]}),{code:'INVALID_FILTER'});

    const rollback=splitSql(fs.readFileSync(path.join(__dirname,'../database/migrations/20270106_email_marketing_rollback.sql'),'utf8'));
    for(const sql of rollback)await db.query(sql);
    const [[table]]=await db.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=? AND table_name='sx_platform_email_provider_settings'",[dbName]);
    assert.equal(Number(table.count),0);
    console.log(JSON.stringify({passed:true,checks:['forward migration','encrypted credential storage','super-admin provider status redaction','concurrent revision conflict','audit secret redaction','Phonebook email-only entry','consent opt-out/re-opt-in history','non-entitled email-field isolation','manual rollback'],syntheticOnly:true}));
  }finally{
    ses.getAccount=originalGetAccount;
    db?.release();await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);await admin.end();
  }
}
main().catch(error=>{console.error(error.stack||error.code||error.message);process.exitCode=1;});
