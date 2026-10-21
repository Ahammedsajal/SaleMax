'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitSql } = require('../database/migration-runner');

function strings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(child => strings(child, result));
  return result;
}

test('every supported UI translation uses the 7Network name and retains its current support address', () => {
  const directory = path.join(__dirname, '../languages');
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.json')).sort();
  assert.equal(files.length, 13);
  for (const file of files) {
    const content = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    assert.equal(content.appName, '7Network', file);
    assert.match(content.copyrightText, /7Network/, file);
    assert.equal(content.conP2, 'info@salemax.qa', file);
    for (const value of strings(content).filter(value => value !== 'info@salemax.qa')) {
      assert.doesNotMatch(value, /\bsalemax\b/i, `${file}: ${value}`);
    }
  }
});

test('Sales chatbot migration renames first-party brand copy without rewriting category or plan history', () => {
  const file = path.join(__dirname, '../database/migrations/20261222_7network_sales_bot_brand.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const statements = splitSql(sql);
  assert.equal(statements.length, 1);
  assert.match(sql, /UPDATE sx_chatbot_profiles/i);
  assert.match(sql, /WHERE category_key = '7network_sales'/i);
  assert.match(sql, /SET name = REPLACE\(name, 'SaleMaX', '7Network'\)/i);
  assert.match(sql, /'salemaxsales', '7network_sales'/i);
  assert.match(sql, /revision = revision \+ 1/i);
  assert.doesNotMatch(sql, /UPDATE\s+sx_(?:tenants|plans|plan_versions|plan_assignments)/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+sx_category_identity_aliases/i);
});
