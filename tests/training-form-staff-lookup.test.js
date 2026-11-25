'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const plans = require('../modules/platform/plans');
const policy = require('../modules/platform/policy');
const originalDecision = policy.decision;
const originalEntitlements = plans.loadEntitlements;
policy.decision = () => ({ allowed: true });
plans.loadEntitlements = async () => ({});
delete require.cache[require.resolve('../modules/platform/training-forms')];
const forms = require('../modules/platform/training-forms');
policy.decision = originalDecision;

const tenantId = '11111111-1111-4111-8111-111111111111';
const ownerUid = 'synthetic-owner';
function fakePool(role, rows, calls) {
  let released = false;
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM user u JOIN sx_legacy_ownership')) return [[{
        tenant_id: tenantId, tenant_slug: 'center', tenant_status: 'active',
        category_key: 'training_center', category_version: 1, owner_role: 'owner',
        owner_membership_status: 'active', owner_identity_status: 'active',
        owner_membership_id: 'membership', owner_identity_id: 'identity',
        legacy_uid_hash: crypto.createHash('sha256').update(ownerUid).digest('hex')
      }]];
      if (sql.includes('FROM agents WHERE')) return [[{id: 7, uid: 'agent-uid'}]];
      if (sql.includes('FROM pipeline_conversations pc')) return [rows];
      if (sql.includes('FROM pipeline_leads l')) return [rows];
      if (sql.includes('FROM sx_training_forms f JOIN')) return [rows];
      throw Error('Unexpected query');
    },
    release() { released = true; }
  };
  return { getConnection: async () => db, released: () => released };
}

test.after(() => { plans.loadEntitlements = originalEntitlements; });

test('staff lead lookup scopes agents to their assigned leads', async () => {
  const calls = [], pool = fakePool('agent', [{id: 'lead', qualificationData: '{}'}], calls);
  const result = await forms.staffLead(pool, {uid: ownerUid, role: 'agent', agentId: 7, agentUid: 'agent-uid'}, 'lead');
  assert.equal(result.id, 'lead');
  assert.deepEqual(result.qualificationData, {});
  const query = calls.find(call => call.sql.includes('FROM pipeline_leads l'));
  assert.match(query.sql, /l.owner_agent_id=\?/);
  assert.equal(query.params[2], 7);
  assert.ok(pool.released());
});

test('a missing or inaccessible lead fails without returning another record', async () => {
  const calls = [], pool = fakePool('agent', [], calls);
  await assert.rejects(forms.staffLead(pool, {uid: ownerUid, role: 'agent', agentId: 7, agentUid: 'agent-uid'}, 'other'), {code: 'LEAD_NOT_ACCESSIBLE'});
  assert.ok(pool.released());
});

test('published form listing is restricted to the actor tenant', async () => {
  const calls = [], pool = fakePool('owner', [{slug: 'registration'}], calls);
  const result = await forms.staffForms(pool, {uid: ownerUid, role: 'owner'});
  assert.equal(result.tenantSlug, 'center');
  assert.equal(result.items[0].slug, 'registration');
  const query = calls.find(call => call.sql.includes('FROM sx_training_forms f JOIN'));
  assert.deepEqual(query.params, [tenantId]);
  assert.match(query.sql, /f.status='published'/);
  assert.ok(pool.released());
});

test('conversation registration requires one accessible lead', async () => {
  const calls = [], pool = fakePool('agent', [{id: 'lead'}], calls);
  const result = await forms.staffChatLead(pool, {uid: ownerUid, role: 'agent', agentId: 7, agentUid: 'agent-uid'}, 'chat-1');
  assert.deepEqual(result, {leadId: 'lead'});
  const query = calls.find(call => call.sql.includes('FROM pipeline_conversations pc'));
  assert.match(query.sql, /l.owner_agent_id=\?/);
  assert.equal(query.params[3], 7);
  assert.ok(pool.released());
});

test('conversation registration refuses ambiguous linked leads', async () => {
  const calls = [], pool = fakePool('owner', [{id: 'one'}, {id: 'two'}], calls);
  await assert.rejects(forms.staffChatLead(pool, {uid: ownerUid, role: 'owner'}, 'chat-1'), {code: 'CHAT_LEAD_AMBIGUOUS'});
  assert.ok(pool.released());
});

test('both pipeline entry points authorize staff capture instead of form management', () => {
  const databasePath=require.resolve('../database/dbpromise');
  const previous=require.cache[databasePath];
  require.cache[databasePath]={id:databasePath,filename:databasePath,loaded:true,exports:{}};
  const { routePermission } = require('../modules/platform/team-role-request-guard');
  if(previous)require.cache[databasePath]=previous;else delete require.cache[databasePath];
  for(const baseUrl of ['/api/pipeline','/api/workspace/pipeline']){
    for(const path of ['/training-forms','/training-forms/registration','/training-forms/registration/leads/123','/training-form-chat/chat']){
      assert.equal(routePermission({baseUrl,path,method:'GET'}),'forms.capture');
    }
    assert.equal(routePermission({baseUrl,path:'/training-forms/registration/submissions',method:'POST'}),'forms.capture');
  }
});
