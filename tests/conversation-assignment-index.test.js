'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const index = require('../modules/platform/conversation-assignment-index');
const { assignedChatSql } = require('../modules/platform/team-inbox-scope');
const { discover } = require('../database/migration-runner');

test('assignment index stores canonical identities and hashed legacy account keys only', async () => {
  const calls = [];
  const db = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM sx_legacy_ownership') && sql.includes("source_table='user'")) return [[{ tenantId: 'tenant-1' }]];
    if (sql.includes('FROM sx_legacy_ownership o JOIN sx_memberships')) return [[{ uidHash: index.hash('agent-uid'), identityId: 'identity-1' }]];
    return [{ affectedRows: 1 }];
  } };
  const result = await index.replaceConversationAssignments(db, {
    uid: 'owner-uid', chatId: 'chat-1', assignedAgent: [{ uid: 'agent-uid', name: 'Private name' }],
  });
  assert.deepEqual(result, { indexed: true, count: 1 });
  const insert = calls.find(call => call.sql.includes('INSERT INTO sx_conversation_assignments'));
  assert.deepEqual(insert.params, ['tenant-1', index.hash('owner-uid'), 'identity-1', 'chat-1']);
  assert.ok(calls.some(call => call.sql.startsWith('DELETE FROM sx_conversation_assignments')));
  assert.ok(calls.every(call => !call.params.includes('owner-uid') && !call.params.includes('agent-uid') && !call.params.includes('Private name')));
});

test('assignment index refuses canonical identity records whose legacy UID mapping disagrees', async () => {
  const db={async query(sql){
    if(sql.includes("WHERE o.source_table='user'"))return [[{tenantId:'tenant-1'}]];
    if(sql.includes('FROM sx_legacy_ownership o JOIN sx_memberships'))return [[{uidHash:index.hash('agent-uid'),identityId:'different-identity'}]];
    return [{affectedRows:1}];
  }};
  await assert.rejects(index.replaceConversationAssignments(db,{uid:'owner-uid',chatId:'chat-1',assignedAgent:[{kind:'identity',identityId:'identity-1',uid:'agent-uid'}]}),{code:'CONVERSATION_ASSIGNMENT_INDEX_MAPPING_MISMATCH'});
});

test('indexed inbox candidates use tenant, owner hash and identity composite index after verified backfill', () => {
  const scope = { canonical: true, assignedOnly: true, identityId: 'identity-1', uid: 'owner-uid', assignmentIndexReady: true, ctx: { tenant: { id: 'tenant-1' } } };
  const result = assignedChatSql(scope, 'bc');
  assert.match(result.sql, /EXISTS \(SELECT 1 FROM sx_conversation_assignments ca/);
  assert.doesNotMatch(result.sql, /assigned_agent LIKE/);
  assert.deepEqual(result.params.slice(0, 3), ['tenant-1', index.hash('owner-uid'), 'identity-1']);
});

test('unbackfilled tenants retain the JSON assignment candidate path', () => {
  const result = assignedChatSql({ canonical: true, assignedOnly: true, identityId: 'identity-1', assignmentIndexReady: false }, 'bc');
  assert.match(result.sql, /bc\.assigned_agent LIKE/);
  assert.deepEqual(result.params, ['%identity-1%']);
});

test('forward migration creates an additive tenant assignment index and readiness marker', () => {
  const migration = discover(path.join(__dirname, '../database/migrations')).find(item => item.file === '20261227_conversation_assignment_index.sql');
  assert.ok(migration);
  assert.equal(migration.statements.length, 2);
  assert.match(migration.statements[0], /ADD COLUMN conversation_assignment_index_ready_at/);
  assert.match(migration.statements[1], /KEY idx_sx_conversation_assignment_chat/);
  assert.doesNotMatch(migration.statements.join('\n'), /\bDROP\b|\bTRUNCATE\b/i);
});
