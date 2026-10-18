'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const sharing=require('../modules/platform/qr-channel-sharing');

const managerUid='synthetic-manager-uid',ownerUid='synthetic-owner-uid';
const managerId='11111111-1111-4111-8111-111111111111',agentId='22222222-2222-4222-8222-222222222222';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const manager={userId:2,uid:managerUid,tenantId:'33333333-3333-4333-8333-333333333333',tenantStatus:'active',categoryKey:'training_center',categoryVersion:1,membershipId:managerId,identityId:'manager-identity',role:'manager',membershipStatus:'active',identityStatus:'active',uidHash:hash(managerUid),roleProfileId:null,assignedNavigation:null};
const agent={membershipId:agentId,identityId:'agent-identity',legacyUid:'synthetic-agent-uid',uidHash:hash('synthetic-agent-uid'),active:1};
const channel={id:7,title:'Support QR',number:'97450000000',status:'ACTIVE',uniqueId:'qr-session-7',createdAt:'2026-10-01'};
function poolFor({authorizedAgent=true,sharedChannel=true,rolePermissions=null,existingShares=[]}={}){
  const calls=[];
  const db={
    async beginTransaction(){calls.push({sql:'BEGIN'});},async commit(){calls.push({sql:'COMMIT'});},async rollback(){calls.push({sql:'ROLLBACK'});},release(){},
    async query(sql,args=[]){
      calls.push({sql,args});
      if(sql.includes('FROM user u JOIN sx_legacy_ownership')&&sql.includes('WHERE u.uid=?'))return [[{...manager,roleProfileId:rolePermissions? 'role-id':null,rolePermissions:rolePermissions?JSON.stringify(rolePermissions):null,seatRole:rolePermissions?'manager':null,roleStatus:rolePermissions?'active':null}]];
      if(sql.includes('FROM sx_plan_assignments'))return [[{id:'plan',status:'active',current_period:1,role_limits:JSON.stringify({owner:1,accountant:1,manager:1,agent:7}),capabilities:JSON.stringify(['team.members','messaging.inbox']),category_key:'training_center',category_version:1}]];
      if(sql.includes('FROM sx_memberships m')&&sql.includes("m.role='owner'")&&sql.includes('legacy_uid_hash'))return [[{membershipId:'owner-membership',identityId:'owner-identity',uid:ownerUid,uidHash:hash(ownerUid)}]];
      if(sql.includes('FROM instance i LEFT JOIN beta_chats'))return [[{...channel,conversationCount:3}]];
      if(sql.includes('FROM sx_sales_org_history org JOIN sx_memberships m'))return [[agent]];
      if(sql.includes('FROM sx_memberships m JOIN sx_identities i')&&sql.includes("m.role='manager'"))return [[]];
      if(sql.includes('SELECT instance_id AS instanceId,membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId'))return [existingShares];
      if(sql.includes('JOIN sx_qr_channel_shares manager_share'))return [sharedChannel?[channel]:[]];
      if(sql.includes('FROM sx_memberships m JOIN sx_identities i')&&sql.includes("o.source_table='agents'")&&sql.includes('FOR UPDATE'))return [authorizedAgent?[agent]:[]];
      if(sql.includes('SELECT membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId')&&sql.includes('granted_by_identity_id=?'))return [existingShares.filter(row=>row.grantedByIdentityId==='manager-identity')];
      if(sql.includes('SELECT membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId'))return [existingShares];
      return [{affectedRows:1}];
    }
  };
  return {pool:{getConnection:async()=>db},calls};
}

test('manager can see only QR connections shared with them and only their assigned agents',async()=>{
  const {pool}=poolFor({existingShares:[{instanceId:7,membershipId:agentId,grantedByIdentityId:'manager-identity'}]});
  const data=await sharing.list(pool,managerUid);
  assert.equal(data.actorRole,'manager');
  assert.equal(data.channels.length,1);
  assert.deepEqual(data.agents.map(item=>item.membershipId),[agentId]);
  assert.deepEqual(data.channels[0].agentMembershipIds,[agentId]);
});

test('manager delegation requires an owner-shared QR connection and an active agent in their team',async()=>{
  const fixture=poolFor();
  const result=await sharing.saveAgentShares(fixture.pool,managerUid,7,[agentId]);
  assert.deepEqual(result,{instanceId:7,agentMembershipIds:[agentId]});
  assert.ok(fixture.calls.some(call=>call.sql.startsWith('INSERT INTO sx_qr_channel_shares')));
  assert.ok(fixture.calls.some(call=>call.sql.includes('whatsapp.qr-agent-access-updated')));
  assert.equal(fixture.calls.at(-1).sql,'COMMIT');
});

test('manager can take over a stale agent grant only while that agent is assigned to their team',async()=>{
  const fixture=poolFor({existingShares:[{instanceId:7,membershipId:agentId,grantedByIdentityId:'previous-manager-identity'}]});
  await sharing.saveAgentShares(fixture.pool,managerUid,7,[agentId]);
  assert.ok(fixture.calls.some(call=>call.sql.startsWith('UPDATE sx_qr_channel_shares SET granted_by_identity_id=?')));
});

test('manager cannot delegate a QR instance they do not hold or to another team’s agent',async()=>{
  const notAssigned=poolFor({authorizedAgent:false});
  await assert.rejects(sharing.saveAgentShares(notAssigned.pool,managerUid,7,[agentId]),{code:'INVALID_AGENT_ASSIGNMENTS'});
  assert.equal(notAssigned.calls.at(-1).sql,'ROLLBACK');
  const wrongChannel=poolFor({sharedChannel:false});
  await assert.rejects(sharing.saveAgentShares(wrongChannel.pool,managerUid,7,[agentId]),{code:'QR_CHANNEL_NOT_SHARED'});
  assert.equal(wrongChannel.calls.at(-1).sql,'ROLLBACK');
});

test('custom manager roles without team invitation authority cannot manage QR shares',async()=>{
  const {pool}=poolFor({rolePermissions:['conversations.read','conversations.reply']});
  await assert.rejects(sharing.list(pool,managerUid),{code:'PERMISSION_DENIED'});
});
