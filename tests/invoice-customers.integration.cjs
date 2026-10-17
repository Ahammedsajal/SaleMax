'use strict';
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const directory=require('../modules/platform/invoice-customers');
async function main(){
  const port=Number(process.env.INVOICE_TEST_PORT);if(process.env.LOCAL_ONLY_MODE!=='true'||!Number.isSafeInteger(port)||port<3307)throw Error('Isolated local database required');
  const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'}),name='invoice_customers_test_'+crypto.randomBytes(6).toString('hex');let db;
  try{await admin.query('CREATE DATABASE '+name);db=await mysql.createConnection({host:'127.0.0.1',port,user:'root',database:name});
    for(const [table,columns] of Object.entries({
      user:'id INT,uid VARCHAR(100)',sx_legacy_ownership:'tenant_id VARCHAR(36),membership_id VARCHAR(36),source_table VARCHAR(30),source_id VARCHAR(30),legacy_uid_hash VARCHAR(64)',
      sx_memberships:'id VARCHAR(36),tenant_id VARCHAR(36),identity_id VARCHAR(36),role VARCHAR(30),status VARCHAR(30)',sx_identities:'id VARCHAR(36),status VARCHAR(30)',
      pipeline_contacts:'id VARCHAR(36),uid_hash VARCHAR(64),display_name VARCHAR(200),normalized_phone VARCHAR(40),normalized_email VARCHAR(200),updated_at DATETIME',
      pipeline_leads:'id VARCHAR(36),uid_hash VARCHAR(64),uid VARCHAR(100),contact_id VARCHAR(36),learner_name VARCHAR(200),contact_name VARCHAR(200),title VARCHAR(200),mobile VARCHAR(40),updated_at DATETIME',
      sx_training_form_submissions:'id VARCHAR(36),tenant_id VARCHAR(36),lead_id VARCHAR(36),submission_data JSON,created_at DATETIME'
    }))await db.query(`CREATE TABLE ${table}(${columns})`);
    const owner='synthetic-owner',hash=crypto.createHash('sha256').update(owner).digest('hex'),otherHash=crypto.createHash('sha256').update('other-owner').digest('hex');
    await db.query("INSERT INTO user VALUES(1,?),(2,'synthetic-accountant')",[owner]);
    await db.query("INSERT INTO sx_identities VALUES('owner-id','active'),('accountant-id','active')");
    await db.query("INSERT INTO sx_memberships VALUES('owner-membership','tenant','owner-id','owner','active'),('accountant-membership','tenant','accountant-id','accountant','active')");
    await db.query("INSERT INTO sx_legacy_ownership VALUES('tenant','owner-membership','user','1',?),('tenant','accountant-membership','user','2',?)",[hash,crypto.createHash('sha256').update('synthetic-accountant').digest('hex')]);
    await db.query("INSERT INTO pipeline_contacts VALUES('linked',?,'Synthetic Contact','97450313785',NULL,NOW()),('standalone',?,'Another Contact','97400000002','contact@example.invalid',NOW()),('foreign',?,'Foreign Contact','97400000003','foreign@example.invalid',NOW())",[hash,hash,otherHash]);
    await db.query("INSERT INTO pipeline_leads VALUES('lead',?,?,'linked','Synthetic Learner','Synthetic Contact','Course enquiry','50313785',NOW()),('foreign-lead',?,'other-owner',NULL,'Foreign Learner','','Other','50313785',NOW())",[hash,owner,otherHash]);
    await db.query("INSERT INTO sx_training_form_submissions VALUES('application','tenant','lead',?,NOW()),('wrong-tenant','foreign','lead',?,NOW())",[JSON.stringify({email:'learner@example.invalid',address:'Saved Doha address'}),JSON.stringify({email:'wrong@example.invalid',address:'Must not appear'})]);
    const ctx={tenant:{id:'tenant'}};
    const recent=await directory.list(db,ctx,{uid:'synthetic-accountant'});assert.equal(recent.length,2);assert.equal(recent.filter(x=>x.source==='lead').length,1);assert(!recent.some(x=>x.id==='linked'||x.id==='foreign'));
    for(const q of ['Synthetic Learner','50313785','+974 5031-3785','learner@example.invalid']){const matches=await directory.list(db,ctx,{q});assert.equal(matches.length,1);assert.equal(matches[0].id,'lead');assert.equal(matches[0].address,'Saved Doha address');}
    assert.equal((await directory.list(db,ctx,{q:'foreign'})).length,0);assert.equal((await directory.list(db,ctx,{q:'%_'})).length,0);
    console.log(JSON.stringify({passed:true,checks:['recent records','tenant owner resolution for accountant','lead/contact deduplication','name/mobile/formatted mobile/email search','application email/address autofill','tenant isolation','escaped wildcards']}));
  }finally{if(db)await db.end();await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
