'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readTenantAdoptionSnapshot, QUERIES } = require('../modules/platform/tenant-adoption-audit');

test('tenant adoption audit returns only aggregate tenant, identity and assignment evidence', async () => {
  const calls = [];
  const responses = [
    [[{ categoryKey: 'training_center', categoryVersion: 1, status: 'active', tenantCount: 2 }]],
    [[{ categoryKey: 'training_center', role: 'owner', status: 'active', membershipCount: 2 }]],
    [[{ sourceTable: 'user', mappingCount: 2, tenantCount: 2, withoutMembership: 0 }]],
    [[{ sourceTable: 'agents', mappingCount: 17, withoutMembership: 0, invalidMembershipReference: 0, withoutLegacyRecord: 6 }]],
    [[{ legacyRole: 'user', membershipRole: 'owner', membershipStatus: 'active', identityStatus: 'active', tenantStatus: 'active', rowCount: 2, unmapped: 0, hashMismatch: 0, inactiveMapping: 0 }]],
    [[{ isActive: 1, membershipRole: 'agent', membershipStatus: 'active', identityStatus: 'active', tenantStatus: 'active', rowCount: 2, unmapped: 0, hashMismatch: 0, invalidActiveMapping: 0 }]],
    [[{ ownerCategory: 'unresolved-owner', isActive: 1, agentCount: 2, ownerUserExists: 0, ownerHasTenantMapping: 0, linkedOwnerCount: 0 }]],
    [[{ assignmentCount: 2, missingVersion: 0, categoryMismatch: 0, historicalAliasAssignmentCount: 1 }]],
  ];
  const connection = { query: async sql => { calls.push(sql); return responses[calls.length - 1]; } };
  const snapshot = await readTenantAdoptionSnapshot(connection);
  assert.equal(calls.length, Object.keys(QUERIES).length);
  assert.equal(snapshot.currentAssignments.categoryMismatch, 0);
  assert.equal(snapshot.currentAssignments.historicalAliasAssignmentCount, 1);
  assert.equal(snapshot.unmappedAgents[0].agentCount, 2);
  assert.equal(snapshot.mappingIntegrity[0].withoutLegacyRecord, 6);
  assert.equal(snapshot.mappingIntegrity[0].invalidMembershipReference, 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /email|phone|password|token|sourceId|tenantId|identityId/i);
  assert.ok(calls.every(sql => /^SELECT\b/i.test(sql.trim())));
  assert.match(QUERIES.legacyMappings,/NOT EXISTS \(SELECT 1 FROM sx_memberships/);
  assert.match(QUERIES.currentAssignments,/salemax_sales/);
  assert.match(QUERIES.legacyUsers,/m\.id IS NULL OR i\.id IS NULL OR t\.id IS NULL/);
});

test('tenant adoption CLI enforces a read-only transaction and query-only audit', async () => {
  const cli = fs.readFileSync(path.join(__dirname, '../scripts/audit-tenant-adoption.cjs'), 'utf8');
  assert.match(cli, /START TRANSACTION READ ONLY/);
  assert.match(cli, /connection\.rollback/);
  assert.ok(Object.values(QUERIES).every(sql => /^SELECT\b/i.test(sql.trim())));
  await assert.rejects(readTenantAdoptionSnapshot(null), { code: 'READ_ONLY_CONNECTION_REQUIRED' });
});
