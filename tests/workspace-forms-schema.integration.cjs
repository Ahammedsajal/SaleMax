'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const path=require('node:path');
const {discover,applyMigrations}=require('../database/migration-runner');

async function main(){
  const host=process.env.DBHOST,port=Number(process.env.DBPORT),database=process.env.SALEMAX_TEST_DATABASE;
  if(process.env.LOCAL_ONLY_MODE!=='true'||!['127.0.0.1','localhost','::1'].includes(host)||!Number.isSafeInteger(port)||port<1||port>65535||!/^salemax_migration_test_[a-z0-9_]{1,40}$/.test(database||'')||!process.env.DBUSER||!process.env.DBPASS)throw Error('DISPOSABLE_LOCAL_MARIADB_REQUIRED');
  const db=await mysql.createConnection({host,port,user:process.env.DBUSER,password:process.env.DBPASS,database,connectTimeout:5000});
  try{
    const [[server]]=await db.query('SELECT VERSION() AS version,DATABASE() AS databaseName');
    assert.match(server.version,/mariadb/i,'the focused Forms migration check requires MariaDB');
    assert.equal(server.databaseName,database);
    const [[existing]]=await db.query('SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    assert.equal(Number(existing.count),0,'refusing to mutate a non-empty test database');

    await db.query(`CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB`);
    const t1=crypto.randomUUID(),t2=crypto.randomUUID(),i1=crypto.randomUUID(),i2=crypto.randomUUID();
    for(const id of [t1,t2])await db.query('INSERT INTO sx_tenants(id) VALUES (?)',[id]);
    for(const id of [i1,i2])await db.query('INSERT INTO sx_identities(id) VALUES (?)',[id]);

    const name='20261022_workspace_forms.sql',migrations=discover(path.join(__dirname,'../database/migrations'));
    const applied=await applyMigrations(db,migrations,{only:name});
    assert.deepEqual(applied.applied,[name]);
    const evidence=await require('./workspace-forms-migration.integration.cjs')(db,{t1,t2,i1,i2});
    console.log(JSON.stringify({mariaDb:server.version,databaseIsDisposable:true,migration:name,...evidence,customerDataTouched:false,externalWrites:false}));
  }finally{await db.end();}
}
main().catch(error=>{process.stderr.write(`${error.code||error.message||'WORKSPACE_FORMS_MIGRATION_FAILED'}\n`);process.exitCode=1;});
