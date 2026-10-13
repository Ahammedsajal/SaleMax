'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const keywords = require('../client/public/pipeline/intent-keywords');

test('pipeline intent keywords can be added without duplicates and stop at the supported limit', () => {
  const first = keywords.add(['Course'], ' course ');
  assert.equal(first.added, false);
  assert.equal(first.reason, 'duplicate');
  const added = keywords.add(['Course'], 'تسجيل');
  assert.deepEqual(added, { keywords: ['Course', 'تسجيل'], added: true, reason: null });
  const full = keywords.add(Array.from({ length: 30 }, (_, index) => `term-${index}`), 'extra');
  assert.equal(full.reason, 'limit');
  assert.equal(full.keywords.length, 30);
});

test('pipeline intent keyword chips escape phrases and provide indexed accessible removal controls', () => {
  const html = keywords.render(['<script>alert(1)</script>', 'دورة'], 'Remove');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-remove-keyword="0" aria-label="Remove &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(html, /data-remove-keyword="1"/);
});

test('pipeline settings expose bilingual suggested keyword choices and post selected chips as the existing array contract', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pipeline = fs.readFileSync(path.join(__dirname, '../client/public/pipeline/pipeline.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../client/public/pipeline/index.html'), 'utf8');
  assert.match(pipeline, /intentSuggestions=\{en:/);
  assert.match(pipeline, /const intentKeywordTools = window\.salemaxIntentKeywords/);
  assert.match(pipeline, /ar:\['دورة'/);
  assert.match(pipeline, /interestKeywords:keywords/);
  assert.match(pipeline, /data-keyword-suggestion/);
  assert.match(pipeline, /data-keyword-custom/);
  assert.doesNotMatch(pipeline, /interestKeywords:String\(get\('interestKeywords'\)\)\.split\(','\)/);
  assert.match(html, /pipeline\/intent-keywords\.js\?v=1/);
  assert.match(html, /pipeline\/pipeline\.js\?v=20261014-lead-click-call1/);
});
