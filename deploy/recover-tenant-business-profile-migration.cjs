'use strict';

const crypto=require('node:crypto');
const path=require('node:path');
const mysql=require('mysql2/promise');
const migrationRunner=require('../database/migration-runner');

const MIGRATION='20270103_tenant_business_profiles.sql';
const PARTIAL_CHECKSUM='dc7d56c29ceb37b4c337e1ddbaaa7a125a1fa56f1d0e52b823c3939cdb07a5d6';
const profileColumns=new Set(['tenant_id','business_name_en','business_name_ar','cr_number','email','phone','website_url','address_en','address_ar','google_maps_url','logo_url','favicon_url','meta_title_en','meta_title_ar','meta_description_en','meta_description_ar','revision','updated_by_identity_id','updated_at']);

async function recover(connection,{log=()=>{}}={}){
  const migrations=migrationRunner.discover(path.join(__dirname,'../database/migrations'));
  const migration=migrations.find(item=>item.file===MIGRATION);
  if(!migration||migration.statements.length!==3)throw Object.assign(new Error('RECOVERY_SOURCE_INVALID'),{code:'RECOVERY_SOURCE_INVALID'});
  const [[database]]=await connection.query('SELECT DATABASE() AS db');
  if(!database?.db)throw Object.assign(new Error('DATABASE_REQUIRED'),{code:'DATABASE_REQUIRED'});
  const lockName='salemax:migrate:'+crypto.createHash('sha256').update(database.db).digest('hex').slice(0,40);
  const [[lock]]=await connection.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]);
  if(Number(lock.acquired)!==1)throw Object.assign(new Error('MIGRATION_LOCKED'),{code:'MIGRATION_LOCKED'});
  try{
    await connection.beginTransaction();
    const sourceByName=new Map(migrations.map(item=>[item.file,item]));
    const [history]=await connection.query('SELECT migration_name,checksum,status FROM salemax_schema_migrations');
    for(const row of history){
      if(row.migration_name===MIGRATION)continue;
      const source=sourceByName.get(row.migration_name);
      if(!source||source.checksum!==row.checksum||row.status!=='applied')throw Object.assign(new Error('RECOVERY_HISTORY_MISMATCH'),{code:'RECOVERY_HISTORY_MISMATCH'});
    }
    const [[ledger]]=await connection.query('SELECT migration_name,checksum,status,statements_completed,statement_count,error_code FROM salemax_schema_migrations WHERE migration_name=? FOR UPDATE',[MIGRATION]);
    if(!ledger||ledger.checksum!==PARTIAL_CHECKSUM||ledger.status!=='failed'||Number(ledger.statements_completed)!==2||Number(ledger.statement_count)!==3||ledger.error_code!=='ER_NON_UNIQ_ERROR')throw Object.assign(new Error('RECOVERY_STATE_MISMATCH'),{code:'RECOVERY_STATE_MISMATCH'});
    const [columns]=await connection.query('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?',["sx_tenant_business_profiles"]);
    if(columns.length!==profileColumns.size||columns.some(column=>!profileColumns.has(column.name)))throw Object.assign(new Error('RECOVERY_SCHEMA_MISMATCH'),{code:'RECOVERY_SCHEMA_MISMATCH'});
    const [[profileCount]]=await connection.query('SELECT COUNT(*) AS count FROM sx_tenant_business_profiles');
    const [[legacyCount]]=await connection.query('SELECT COUNT(*) AS count FROM sx_tenant_crm_branding');
    if(Number(profileCount.count)!==0||Number(legacyCount.count)!==0)throw Object.assign(new Error('RECOVERY_DATA_MISMATCH'),{code:'RECOVERY_DATA_MISMATCH'});
    const [[expected]]=await connection.query('SELECT COUNT(DISTINCT tenant_id) AS count FROM sx_training_center_profiles');
    await connection.query(migration.statements[2]);
    const [[actual]]=await connection.query('SELECT COUNT(*) AS count FROM sx_tenant_business_profiles');
    if(Number(actual.count)!==Number(expected.count))throw Object.assign(new Error('RECOVERY_ROW_COUNT_MISMATCH'),{code:'RECOVERY_ROW_COUNT_MISMATCH'});
    await connection.query('UPDATE salemax_schema_migrations SET checksum=?,status=?,statements_completed=?,completed_at=CURRENT_TIMESTAMP(3),error_code=NULL WHERE migration_name=?',[migration.checksum,'applied',3,MIGRATION]);
    await connection.commit();
    log({migration:MIGRATION,status:'applied',statementsCompleted:3,profileRows:Number(actual.count),checksum:migration.checksum});
    return {migration:MIGRATION,status:'applied',statementsCompleted:3,profileRows:Number(actual.count),checksum:migration.checksum};
  }catch(error){await connection.rollback().catch(()=>{});throw error;}
  finally{await connection.query('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});}
}

async function main(){
  for(const key of ['DBHOST','DBUSER','DBNAME'])if(!process.env[key])throw Object.assign(new Error('DATABASE_CONFIG_REQUIRED'),{code:'DATABASE_CONFIG_REQUIRED'});
  const connection=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4',multipleStatements:false});
  try{await recover(connection,{log:result=>console.log(JSON.stringify(result))});}
  finally{await connection.end();}
}

if(require.main===module)main().catch(error=>{console.error('Migration recovery stopped:',error.code||'RECOVERY_FAILED');process.exitCode=1;});
module.exports={recover,MIGRATION,PARTIAL_CHECKSUM};
