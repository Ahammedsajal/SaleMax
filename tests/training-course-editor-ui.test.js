'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../client/public/training-courses.js'), 'utf8');
const durationHelper = source.match(/function courseDurationSummary\(course\)\{[^\n]+\}/)?.[0];
const deliveryHelper = source.match(/function courseDeliverySummary\(value\)\{[^\n]+\}/)?.[0];

test('course editor summary replaces missing catalogue values with readable localized wording', () => {
  assert.ok(durationHelper, 'duration summary helper exists');
  assert.ok(deliveryHelper, 'delivery summary helper exists');
  const summarize = new Function('tr', `${durationHelper}${deliveryHelper}; return { courseDurationSummary, courseDeliverySummary };`);
  const english = summarize((en) => en);
  assert.equal(english.courseDurationSummary({ durationValue: null, durationUnit: null }), 'Duration not set');
  assert.equal(english.courseDurationSummary({ durationValue: 0, durationUnit: null }), 'Duration not set');
  assert.equal(english.courseDurationSummary({ durationValue: 8, durationUnit: 'weeks' }), '8 weeks');
  assert.equal(english.courseDeliverySummary(null), 'Delivery not set');
  assert.equal(english.courseDeliverySummary('hybrid'), 'Hybrid');

  const arabic = summarize((_en, ar) => ar);
  assert.equal(arabic.courseDurationSummary({ durationValue: 8, durationUnit: 'weeks' }), '8 أسابيع');
  assert.equal(arabic.courseDeliverySummary('in_person'), 'حضوري');
  assert.equal(arabic.courseDeliverySummary(null), 'طريقة التقديم غير محددة');
});

test('Sales catalogue asks for product or service type and preserves legacy rows for review',()=>{
  assert.match(source,/select\.name='itemKind'/);
  assert.match(source,/select\.value='service'/);
  assert.match(source,/const item=products\?\{\.\.\.common,itemKind:f\.get\('itemKind'\),tags:parseTags\(f\.get\('tags'\)\)\}/);
  assert.match(source,/select\.value=c\.itemKind\|\|'unclassified'/);
  assert.match(source,/PRODUCT_TYPE_REVIEW_REQUIRED/);
  assert.match(source,/before publishing this product or service/);
  assert.match(source,/tags:parseTags\(f\.get\('tags'\)\)/);
  assert.match(source,/function hideTrainingFields\(form\)/);
  assert.match(source,/setAttribute\('hidden',''\)/);
  assert.match(source,/ACTIVE_PRICE_REQUIRED/);
});
