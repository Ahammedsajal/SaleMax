'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const organization=require('../modules/platform/sales-organization');
const {salemaxSales,trainingCenter}=require('../modules/platform/categories');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function context(role='owner'){
  return {audience:'tenant',identity:{id:id(90)},tenant:{id:id(1),status:'active',categoryKey:salemaxSales.key,categoryVersion:salemaxSales.version},
    category:salemaxSales,subscription:{status:'active',capabilities:['team.members']},
    membership:{id:id(role==='manager'?2:role==='team_leader'?3:1),tenantId:id(1),role,status:'active',customPermissions:null,delegatedPermissions:[],assignedNavigation:null}};
}
function dbMock({targetRole='agent',current=null,followers=[]}={}){
  const calls=[];let committed=false,rolledBack=false;
  return {calls,get committed(){return committed;},get rolledBack(){return rolledBack;},
    async beginTransaction(){},async commit(){committed=true;},async rollback(){rolledBack=true;},
    async query(sql,args=[]){
      calls.push({sql,args});
      if(sql.startsWith('SELECT id FROM sx_tenants'))return [[{id:id(1)}]];
      if(sql.startsWith('SELECT id,role,status FROM sx_memberships')){
        const value=args[1]===id(10)?{id:id(10),role:targetRole,status:'active'}:[id(2),id(5)].includes(args[1])?{id:args[1],role:'manager',status:'active'}:args[1]===id(3)?{id:id(3),role:'team_leader',status:'active'}:null;
        return [[...(value?[value]:[])],[]];
      }
      if(sql.startsWith('SELECT manager_membership_id AS managerMembershipId FROM sx_sales_org_history'))return [[{managerMembershipId:id(2)}],[]];
      if(sql.startsWith('SELECT manager_membership_id AS managerMembershipId,team_leader_membership_id AS teamLeaderMembershipId,reason'))return [[...(current?[current]:[])],[]];
      if(sql.startsWith('SELECT membership_id AS membershipId FROM sx_sales_org_history'))return [followers.map(membershipId=>({membershipId})),[]];
      if(sql.startsWith('SELECT team_leader_membership_id AS teamLeaderMembershipId'))return [[{teamLeaderMembershipId:id(10)}],[]];
      return [{affectedRows:1},[]];
    }};
}

test('organisation context is restricted to active 7Network Sales tenants with an enabled team entitlement',()=>{
  assert.doesNotThrow(()=>organization.assertContext(context()));
  assert.doesNotThrow(()=>organization.assertContext({...context(),tenant:{...context().tenant,categoryKey:'salemax_sales'}}));
  assert.throws(()=>organization.assertContext({...context(),category:trainingCenter}),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>organization.assertContext({...context(),subscription:{status:'expired',capabilities:['team.members']}}),{code:'FEATURE_UNAVAILABLE'});
  assert.throws(()=>organization.assertContext({...context(),subscription:{status:'active',capabilities:[]}}),{code:'FEATURE_UNAVAILABLE'});
});

test('manager reassignment remains within the manager and records the audit transaction',async()=>{
  const db=dbMock(),ctx=context('manager');
  const result=await organization.reassign(db,ctx,id(10),{managerMembershipId:id(2),teamLeaderMembershipId:id(3),reason:'Move to a better fit'});
  assert.equal(result.managerMembershipId,id(2));
  assert.equal(result.teamLeaderMembershipId,id(3));
  assert.equal(result.unchanged,false);
  assert.equal(db.committed,true);
  assert.equal(db.rolledBack,false);
  assert.ok(db.calls.some(call=>call.sql.includes('sales.organisation.reassigned')));
});

test('moving a team leader preserves their agents and changes their manager history atomically',async()=>{
  const db=dbMock({targetRole:'team_leader',current:{managerMembershipId:id(2),teamLeaderMembershipId:null},followers:[id(11),id(12)]});
  const result=await organization.reassign(db,context('owner'),id(10),{managerMembershipId:id(5),reason:'Manager change'});
  assert.equal(result.followersMoved,2);
  assert.equal(db.calls.filter(call=>call.sql.startsWith('INSERT INTO sx_sales_org_history')).length,3);
  assert.equal(db.committed,true);
});

test('a manager cannot move an agent from another manager',async()=>{
  const db=dbMock({current:{managerMembershipId:id(4),teamLeaderMembershipId:id(3)}});
  await assert.rejects(()=>organization.reassign(db,context('manager'),id(10),{managerMembershipId:id(2),teamLeaderMembershipId:id(3),reason:'Move'}),{code:'PERMISSION_DENIED'});
  assert.equal(db.committed,false);
  assert.equal(db.rolledBack,true);
});
