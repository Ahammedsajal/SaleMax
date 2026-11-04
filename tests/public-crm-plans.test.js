'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const presentation=require('../client/public/website/plan-presentation');
const {trainingCenter,salemaxSales}=require('../modules/platform/categories');
const {update,definitions,hash}=require('../scripts/update-public-crm-plans.cjs');
test('public plan features exist in both real category manifests and exclude industry-only modules',()=>{
 for(const feature of presentation.features)for(const capability of feature.capabilities){assert.ok(trainingCenter.capabilities.includes(capability),capability);assert.ok(salemaxSales.capabilities.includes(capability),capability);}
 assert.ok(!presentation.features.some(f=>f.capabilities.some(c=>/^(training|finance|sales|hr)\./.test(c))));
});
test('only the existing monthly/yearly paid IDs are selected and savings derive from actual prices',()=>{
 const plans=[{id:17,is_trial:1,price:0,plan_duration_in_days:10},...definitions.map(p=>({...p,is_trial:0})),{id:99,is_trial:0,price:1,plan_duration_in_days:30}];
 assert.deepEqual(presentation.select(plans).map(p=>p.id),[26,25]);assert.deepEqual(presentation.savings(plans[1],plans[2]),{amount:600,percent:14});
 assert.equal(presentation.savings(null,plans[2]),null);assert.equal(presentation.select([{...plans[1],plan_duration_in_days:180}]).length,0);
});
function fixture(){const rows=definitions.map(p=>({...p,is_trial:0,price_strike:'500',allow_chatbot:1,contact_limit:'10000',qr_account:10})).sort((a,b)=>a.id-b.id),customers=[{id:1,plan:'{"price":700}',plan_expire:'preserved'}];const writes=[];let committed=false,rolledBack=false;return {rows,customers,writes,get committed(){return committed;},get rolledBack(){return rolledBack;},db:{async beginTransaction(){},async commit(){committed=true;},async rollback(){rolledBack=true;},async query(sql,args){if(sql.startsWith('SELECT * FROM plan'))return [rows];if(sql.startsWith('SELECT id,plan,plan_expire FROM user'))return [customers];if(sql.startsWith('UPDATE plan SET')){writes.push({sql,args});return [{affectedRows:1}];}throw Error('UNEXPECTED_SQL');}}};}
test('catalogue maintenance requires reviewed current state and protected backup and preserves assignments',async()=>{
 let f=fixture();await assert.rejects(update(f.db,{apply:true,expectedHash:'stale',saveBackup:async()=>{}}),/STALE_CATALOGUE/);assert.equal(f.writes.length,0);assert.ok(f.rolledBack);
 f=fixture();await assert.rejects(update(f.db,{apply:true,expectedHash:hash(f.rows)}),/BACKUP_REQUIRED/);assert.equal(f.writes.length,0);
 f=fixture();let prechangeBackup;const preview=await update(f.db,{backupOnly:true,expectedHash:hash(f.rows),saveBackup:async data=>{prechangeBackup=data;}});assert.equal(preview.backupCreated,true);assert.equal(f.writes.length,0);assert.equal(f.committed,false);assert.ok(f.rolledBack);assert.equal(prechangeBackup.plans.length,2);
 f=fixture();let backup;const result=await update(f.db,{apply:true,expectedHash:hash(f.rows),saveBackup:async data=>{backup=data;}});assert.equal(f.writes.length,2);assert.equal(backup.plans.length,2);assert.ok(f.committed);assert.ok(result.customerAssignmentsUnchanged);
 assert.ok(f.writes.every(w=>!/(contact_limit|qr_account|allow_|user SET)/.test(w.sql)));assert.deepEqual(f.writes.map(w=>w.args[2]),[370,3840]);
});
