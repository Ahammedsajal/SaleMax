'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reconcileExisting}=require('../modules/platform/training-lead-journey');

test('known non-Training categories cannot run Training enrollment reconciliation',async()=>{
  let connections=0;
  const pool={async getConnection(){connections++;throw new Error('must not connect')}};
  for(const categoryKey of ['7network_sales','salemax_sales','real_estate','base_crm','restaurant_fixture','future_clinic']){
    assert.equal(await reconcileExisting(pool,{uid:'shared-legacy-owner',categoryKey}),0,categoryKey);
  }
  assert.equal(connections,0);
});

test('Training and unmapped legacy workspaces retain their reconciliation path',async()=>{
  const calls=[];
  const connection={
    async beginTransaction(){},async commit(){},async rollback(){},release(){},
    async query(sql){calls.push(sql);if(sql.includes('SELECT DISTINCT tenant_id'))return [[{tenant_id:12}]];if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:12}]];if(sql.includes('FROM pipeline_leads l JOIN sx_training_enrollments e'))return [[],[]];throw new Error(`Unexpected query: ${sql}`);},
  };
  const pool={async getConnection(){return connection;}};
  assert.equal(await reconcileExisting(pool,{uid:'training-owner',categoryKey:'training_center'}),0);
  assert.equal(await reconcileExisting(pool,{uid:'unmapped-legacy-owner'}),0);
  assert.equal(calls.filter(sql=>sql.includes('SELECT DISTINCT tenant_id')).length,2);
});
