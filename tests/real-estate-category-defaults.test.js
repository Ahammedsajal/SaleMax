'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('../modules/platform/categories');
const customization = require('../modules/platform/tenant-customization');

const publishedDocument = label => ({
  schemaVersion: 4,
  navigationLabels: {},
  hiddenNavigation: [],
  stageLabels: { won: label },
});

function database(revisions) {
  return {
    async query(sql, values) {
      if (sql.includes('FROM sx_tenant_customization_heads')) {
        const row = revisions.get(values[0]);
        return [[row ? { revision: row.revision, active_id: row.id } : undefined].filter(Boolean)];
      }
      if (sql.includes('FROM sx_tenant_customization_revisions')) {
        const row = [...revisions.values()].find(item => item.tenant_id === values[0] && item.id === values[1]);
        return [[row].filter(Boolean)];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function context(tenantId, category) {
  return {
    audience: 'tenant',
    tenant: { id: tenantId, status: 'active', categoryKey: category.key, categoryVersion: category.version },
    membership: { tenantId, status: 'active' },
    category,
  };
}

test('Real Estate v5 introduces immutable bilingual Pipeline terminology without changing v1-v4', () => {
  const v4 = categories.getCategory('real_estate', 4);
  const v5 = categories.getCategory('real_estate', 5);

  assert.equal(v4.customizationDefaults, undefined);
  assert.equal(v5.public, false);
  assert.equal(v5.planable, false);
  assert.deepEqual(v5.capabilities, v4.capabilities);
  assert.equal(v5.customizationDefaults.schemaVersion, 4);
  assert.deepEqual(v5.customizationDefaults.navigationLabels.leads, {
    en: 'Property enquiries', ar: 'استفسارات العقارات',
  });
  assert.deepEqual(v5.customizationDefaults.stageLabels.won, {
    en: 'Agreement reached', ar: 'تم الاتفاق',
  });
  assert.equal(Object.isFrozen(v5.customizationDefaults.stageLabels), true);
  assert.throws(() => { v5.customizationDefaults.stageLabels.won.en = 'Changed'; }, TypeError);
});

test('two published Real Estate tenant revisions inherit defaults but keep their own stage labels', async () => {
  const category = categories.getCategory('real_estate', 5);
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const docs = new Map([[tenantA, publishedDocument({ en: 'Lease signed', ar: 'تم توقيع عقد الإيجار' })],
    [tenantB, publishedDocument({ en: 'Property transaction closed', ar: 'أُغلقت معاملة العقار' })]]);
  const revisions = new Map([...docs].map(([tenantId, document], index) => {
    const row = { id: `published-${index + 1}`, tenant_id: tenantId, category_key: category.key,
      category_version: category.version, schema_version: 4, revision: 1, kind: 'published',
      document: JSON.stringify(document), checksum: customization.checksum(document), created_at: new Date() };
    return [tenantId, row];
  }));
  const db = database(revisions);
  const effectiveA = await customization.effective(db, context(tenantA, category));
  const effectiveB = await customization.effective(db, context(tenantB, category));

  assert.equal(effectiveA.document.stageLabels.won.en, 'Lease signed');
  assert.equal(effectiveB.document.stageLabels.won.en, 'Property transaction closed');
  assert.equal(effectiveA.document.stageLabels.new.en, 'New enquiry');
  assert.equal(effectiveB.document.stageLabels.new.en, 'New enquiry');
  assert.equal(effectiveA.document.navigationLabels.leads.en, 'Property enquiries');
  assert.equal(effectiveB.document.navigationLabels.leads.ar, 'استفسارات العقارات');
  assert.doesNotMatch(JSON.stringify(effectiveA.document), /Property transaction closed/);
  assert.doesNotMatch(JSON.stringify(effectiveB.document), /Lease signed/);
});
