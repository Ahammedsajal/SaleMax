'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('../modules/platform/categories');
const taskAdapters = require('../modules/platform/task-type-adapters');

function context(category, capabilities = category.capabilities) {
  return {
    tenant: { categoryKey: category.key, categoryVersion: category.version },
    category,
    subscription: { status: 'active', capabilities },
  };
}

test('versioned manifests expose only their reviewed task adapters', () => {
  const training = categories.getCategory('training_center', 1);
  const sales = categories.getCategory('7network_sales', 1);
  const realEstate = categories.getCategory('real_estate', 4);

  assert.deepEqual(training.taskAdapters, { invoice_follow_up: 1, enrollment: 1 });
  assert.deepEqual(sales.taskAdapters, { sales_call: 1 });
  assert.equal(realEstate.taskAdapters, undefined);
  assert.equal(Object.isFrozen(training.taskAdapters), true);
  assert.equal(Object.isFrozen(sales.taskAdapters), true);
  assert.throws(() => { sales.taskAdapters.sales_call = 99; }, TypeError);
});

test('task adapter availability follows both category contract and current plan capabilities', () => {
  const training = categories.getCategory('training_center', 1);
  const sales = categories.getCategory('salemax_sales', 1);
  const trainingTypes = taskAdapters.available(context(training)).map(item => item.key);
  const salesTypes = taskAdapters.available(context(sales)).map(item => item.key);

  assert.ok(trainingTypes.includes('invoice_follow_up'));
  assert.ok(trainingTypes.includes('enrollment'));
  assert.ok(!trainingTypes.includes('sales_call'));
  assert.ok(salesTypes.includes('sales_call'));
  assert.ok(!salesTypes.includes('invoice_follow_up'));
  assert.equal(taskAdapters.supports(context(sales), 'sales_call'), true);
  assert.equal(taskAdapters.supports(context(sales, sales.capabilities.filter(key => key !== 'telephony.call-center')), 'sales_call'), false);
  assert.equal(taskAdapters.supports(context(training, training.capabilities.filter(key => key !== 'training.enrollments')), 'enrollment'), false);
});
