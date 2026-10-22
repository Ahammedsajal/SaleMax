'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../modules/platform/policy');
const categories = require('../modules/platform/categories');

function withFutureFeature() {
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === './category-registry') {
      const registry = require('../modules/platform/category-registry');
      return { createCategoryRegistry: (definitions, capabilities) => registry.createCategoryRegistry(
        JSON.parse(JSON.stringify(definitions)), JSON.parse(JSON.stringify(capabilities)),
      ) };
    }
    if (name === './task-type-adapters') return require('../modules/platform/task-type-adapters');
    assert.equal(name, './policy');
    return { capabilities: { ...policy.capabilities, 'clinic.patient-records': ['patients.read'] } };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../modules/platform/categories.js'), 'utf8'), sandbox);
  return sandbox.module.exports;
}

test('new platform features do not silently enroll any existing category', () => {
  const future = withFutureFeature();
  for (const name of ['trainingCenter', 'salemaxSales', 'restaurantFixture']) {
    assert.equal(future[name].capabilities.includes('clinic.patient-records'), false);
    assert.deepEqual([...future[name].capabilities], [...categories[name].capabilities]);
  }
});

test('shared messaging and automation stay available in both commercial category contracts', () => {
  for (const category of [categories.trainingCenter, categories.salemaxSales]) {
    for (const capability of ['messaging.inbox', 'messaging.qr', 'messaging.meta', 'messaging.templates', 'automation.flows', 'automation.chatbot']) {
      assert.equal(category.capabilities.includes(capability), true, `${category.key}: ${capability}`);
    }
    assert.equal(new Set(category.capabilities).size, category.capabilities.length);
    for (const capability of category.capabilities) assert.ok(Object.hasOwn(policy.capabilities, capability));
  }
});

test('catalogue and workflow separation remains explicit', () => {
  assert.ok(categories.trainingCenter.capabilities.includes('training.courses'));
  assert.equal(categories.trainingCenter.capabilities.includes('products.catalog'), false);
  for (const capability of ['training.courses', 'training.batches', 'training.enrollments', 'finance.invoices']) {
    assert.equal(categories.salemaxSales.capabilities.includes(capability), false);
  }
  assert.ok(categories.salemaxSales.capabilities.includes('products.catalog'));
});

test('Real Estate manifests share the canonical v1-v3 migration history and append parties after reserved Retail IDs', () => {
  const migrations = path.join(__dirname, '../database/migrations');
  const versions = [
    [categories.realEstate, '20261222_real_estate_properties.sql'],
    [categories.realEstateV2, '20261223_real_estate_requirements.sql'],
    [categories.realEstateV3, '20261224_real_estate_viewings.sql'],
    [categories.realEstateV4, '20261234_real_estate_parties.sql'],
    [categories.realEstateV5, '20261234_real_estate_parties.sql'],
  ];
  for (const [manifest, migration] of versions) {
    assert.equal(manifest.migration, migration);
    assert.ok(fs.existsSync(path.join(migrations, migration)), `${manifest.key}@${manifest.version}`);
  }
  assert.ok(fs.existsSync(path.join(migrations, '20261226_real_estate_chatbot_visibility.sql')));
  for (const obsolete of [29, 30, 31, 32, 33]) {
    assert.equal(fs.readdirSync(migrations).some(file => file.startsWith(`202612${obsolete}_real_estate_`)), false);
  }
});

test('category metadata cannot be mutated for other requests or tenants', () => {
  for (const category of [categories.trainingCenter, categories.salemaxSales, categories.restaurantFixture]) {
    assert.throws(() => { category.title.en = 'Another business'; }, TypeError);
    assert.throws(() => { category.capabilities.push('clinic.patient-records'); }, TypeError);
    assert.throws(() => { category.seatRoles.push('doctor'); }, TypeError);
    assert.equal(categories.getCategory(category.key, category.version), category);
    assert.equal(categories.getCategory(category.key, category.version + 100), null);
  }
});

test('historical Training Center v1 feature assignments are preserved pending reviewed adoption', () => {
  // These were accidentally inherited by the old all-except-four declaration.
  // Removing them from a published version would silently rewrite contracts.
  assert.ok(categories.trainingCenter.capabilities.includes('sales.finance'));
  assert.ok(categories.trainingCenter.capabilities.includes('hr.recruitment'));
  assert.equal(categories.trainingCenter.capabilities.length, 27);
});
