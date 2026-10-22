'use strict';

// Run only with a credential restricted to an empty, disposable schema.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const categories = require('../modules/platform/categories');
const settings = require('../modules/platform/tenant-customization');
const { describeWithNavigation } = require('../modules/platform/feature-contract');

if (process.env.REALESTATE_STAGE_SYNTHETIC_ONLY !== 'true') {
  throw Error('REALESTATE_STAGE_SYNTHETIC_ONLY_REQUIRED');
}
const config = JSON.parse(fs.readFileSync(process.env.REALESTATE_STAGE_TEST_CONFIG, 'utf8'));
if (!/^sx_realestate_stage_test_[a-f0-9]+$/.test(config.database) || config.database !== config.user) {
  throw Error('DISPOSABLE_REALESTATE_STAGE_SCHEMA_REQUIRED');
}

const pool = mysql.createPool({ ...config, connectionLimit: 6, multipleStatements: false });
const category = categories.realEstateV5;
const schema = [
  'CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,category_key VARCHAR(80),category_version INT,status VARCHAR(20)) ENGINE=InnoDB',
  'CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20)) ENGINE=InnoDB',
  'CREATE TABLE sx_memberships(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),identity_id CHAR(36),role VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB',
  'CREATE TABLE sx_plan_versions(id CHAR(36) PRIMARY KEY,category_key VARCHAR(80),category_version INT,capabilities JSON,status VARCHAR(20)) ENGINE=InnoDB',
  'CREATE TABLE sx_plan_assignments(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),plan_version_id CHAR(36),current_tenant CHAR(36),status VARCHAR(20),role_limits JSON,effective_from DATETIME(3),expires_at DATETIME(3)) ENGINE=InnoDB',
  'CREATE TABLE sx_audit_events(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),actor_identity_id CHAR(36),actor_kind VARCHAR(20),action VARCHAR(100),resource_type VARCHAR(80),resource_id CHAR(36),changes JSON,correlation_id CHAR(36)) ENGINE=InnoDB',
];

async function fixture(name) {
  const tenantId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const planVersionId = crypto.randomUUID();
  await pool.query("INSERT INTO sx_tenants VALUES (?,?,?,'active')", [tenantId, category.key, category.version]);
  await pool.query("INSERT INTO sx_identities VALUES (?,'active')", [identityId]);
  await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,'owner','active')", [membershipId, tenantId, identityId]);
  await pool.query("INSERT INTO sx_plan_versions VALUES (?,?,?,?,'published')", [planVersionId, category.key, category.version, JSON.stringify(category.capabilities)]);
  await pool.query("INSERT INTO sx_plan_assignments VALUES (?,?,?,?,'active',?,TIMESTAMPADD(DAY,-1,UTC_TIMESTAMP(3)),TIMESTAMPADD(DAY,1,UTC_TIMESTAMP(3)))", [crypto.randomUUID(), tenantId, planVersionId, tenantId, JSON.stringify(Object.fromEntries(category.seatRoles.map(role => [role, role === 'owner' ? 1 : 5])))]);
  return {
    context: {
      audience: 'tenant',
      identity: { id: identityId },
      tenant: { id: tenantId, status: 'active', categoryKey: category.key, categoryVersion: category.version },
      membership: { id: membershipId, tenantId, role: 'owner', status: 'active' },
      category,
      subscription: { status: 'active', categoryKey: category.key, categoryVersion: category.version, capabilities: [...category.capabilities] },
    },
  };
}

const stageDocument = won => ({
  schemaVersion: 4,
  navigationLabels: {},
  hiddenNavigation: [],
  stageLabels: { won },
});
async function change(context, body, action) {
  const db = await pool.getConnection();
  try { return await settings.mutate(db, context, body, action); }
  finally { db.release(); }
}

process.env.SALEMAX_PLATFORM_ENABLED = 'true';
(async () => {
  try {
    const [[existing]] = await pool.query('SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    assert.equal(Number(existing.total), 0, 'synthetic schema must be empty');
    for (const sql of schema) await pool.query(sql);
    const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/20261220_tenant_customization.sql'), 'utf8');
    for (const sql of require('../database/migration-runner').splitSql(migration)) await pool.query(sql);

    const a = await fixture('A');
    const b = await fixture('B');
    const labelA = { en: 'Lease signed', ar: 'تم توقيع عقد الإيجار' };
    const labelB = { en: 'Property transaction closed', ar: 'أُغلقت صفقة العقار' };
    await Promise.all([
      change(a.context, { expectedRevision: 0, document: stageDocument(labelA) }, 'draft'),
      change(b.context, { expectedRevision: 0, document: stageDocument(labelB) }, 'draft'),
    ]);
    await Promise.all([
      change(a.context, { expectedRevision: 1 }, 'publish'),
      change(b.context, { expectedRevision: 1 }, 'publish'),
    ]);

    const [contractA, contractB] = await Promise.all([
      describeWithNavigation(pool, { context: a.context }),
      describeWithNavigation(pool, { context: b.context }),
    ]);
    assert.equal(contractA.stageLabels.won.en, labelA.en);
    assert.equal(contractB.stageLabels.won.en, labelB.en);
    assert.equal(contractA.stageLabels.won.ar, labelA.ar);
    assert.equal(contractB.stageLabels.won.ar, labelB.ar);
    assert.equal(contractA.stageLabels.new.en, category.customizationDefaults.stageLabels.new.en);
    assert.equal(contractB.stageLabels.new.en, category.customizationDefaults.stageLabels.new.en);
    assert.notEqual(contractA.stageLabels.won.en, contractB.stageLabels.won.en);
    assert.doesNotMatch(JSON.stringify(contractA), /Property transaction closed|أُغلقت صفقة العقار/);
    assert.doesNotMatch(JSON.stringify(contractB), /Lease signed|تم توقيع عقد الإيجار/);
    assert.equal(contractA.navigationLabels.leads.en, 'Property enquiries');
    assert.equal(contractB.navigationLabels.leads.ar, 'استفسارات العقارات');

    console.log(JSON.stringify({
      passed: true,
      checks: [
        'two Real Estate v5 tenants publish distinct bilingual won-stage terminology',
        'published workspace contracts remain tenant scoped and inherit category defaults',
      ],
      customerDataTouched: false,
      externalMessages: 0,
    }));
  } finally {
    await pool.end();
  }
})().catch(error => {
  console.error(JSON.stringify({ code: error.code || error.name, message: error.message, stack: error.stack }));
  process.exitCode = 1;
});
