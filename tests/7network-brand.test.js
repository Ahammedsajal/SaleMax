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

test('compact sidebar branding uses the approved 7Network icon and preserves full wordmarks elsewhere', () => {
  const script = fs.readFileSync(path.join(__dirname, '../client/public/7network-brand.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../client/public/7network-brand.css'), 'utf8');
  assert.match(script, /const compactBrand = Boolean\(img\.closest\('\.logo-box'\)\)/);
  assert.match(script, /const icon = compactBrand \|\|/);
  assert.match(script, /logo-dark\.png\?v=20261021-final-horizontal1/);
  assert.match(script, /logo-light\.png\?v=20261021-final-horizontal1/);
  assert.match(styles, /\.logo-box img\[data-seven-network-brand="icon"\][^{]*\{[^}]*width: 50px/);
  const exporter = fs.readFileSync(path.join(__dirname, '../scripts/export-7network-brand.cjs'), 'utf8');
  assert.match(exporter, /logo-horizontal-source\.png/);
  assert.match(exporter, /makeDarkWordmark/);
  assert.match(exporter, /logo-horizontal-master-transparent\.png/);
});

test('the finalized horizontal logo source and generated light/dark variants retain transparency', async () => {
  const sharp = require('sharp');
  const directory = path.join(__dirname, '../client/public/branding/7network');
  for (const file of ['logo-horizontal-source.png', 'logo-horizontal-master-transparent.png', 'logo-light.png', 'logo-dark.png']) {
    const metadata = await sharp(path.join(directory, file)).metadata();
    assert.equal(metadata.format, 'png', file);
    assert.equal(metadata.hasAlpha, true, file);
    assert.ok(metadata.width >= 1600, `${file} should remain suitable for full-size use`);
  }
  const meanWordmarkBrightness = async file => {
    const { data, info } = await sharp(path.join(directory, file))
      .extract({ left: 650, top: 170, width: 600, height: 360 })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let total = 0, count = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 32) continue;
      total += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      count++;
    }
    return total / count;
  };
  assert.ok(
    await meanWordmarkBrightness('logo-dark.png') > await meanWordmarkBrightness('logo-light.png') + 30,
    'the dark-surface variant should raise the navy wordmark contrast',
  );
});

test('Sales chatbot migrations normalize first-party bot branding and its category key without rewriting history', () => {
  const textFile = path.join(__dirname, '../database/migrations/20261222_7network_sales_bot_brand.sql');
  const textSql = fs.readFileSync(textFile, 'utf8');
  assert.equal(splitSql(textSql).length, 1);
  assert.match(textSql, /UPDATE sx_chatbot_profiles/i);
  assert.match(textSql, /WHERE category_key = '7network_sales'/i);
  assert.match(textSql, /SET name = REPLACE\(name, 'SaleMaX', '7Network'\)/i);
  assert.match(textSql, /revision = revision \+ 1/i);

  const keyFile = path.join(__dirname, '../database/migrations/20261223_7network_sales_domainpack_key.sql');
  const keySql = fs.readFileSync(keyFile, 'utf8');
  assert.equal(splitSql(keySql).length, 1);
  assert.match(keySql, /JSON_SET\(config, '\$\.domainPack', '7network_sales'\)/i);
  assert.match(keySql, /IN \('salemax_sales', 'salemaxsales'\)/i);
  assert.match(keySql, /WHERE category_key = '7network_sales'/i);
  for (const sql of [textSql, keySql]) {
    assert.doesNotMatch(sql, /UPDATE\s+sx_(?:tenants|plans|plan_versions|plan_assignments)/i);
    assert.doesNotMatch(sql, /DELETE\s+FROM\s+sx_category_identity_aliases/i);
  }
});
