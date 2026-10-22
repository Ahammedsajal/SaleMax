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

test('public page copy and accessible labels use 7Network while legacy hosts and asset paths remain compatible', () => {
  const files = [
    '../client/public/index.html',
    '../client/public/website/index.html',
    '../client/public/recruitment-application.html',
  ];
  for (const relativePath of files) {
    const html = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    const withoutNonVisualContent = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const visible = [withoutNonVisualContent.replace(/<[^>]*>/g, ' ')];
    for (const match of withoutNonVisualContent.matchAll(/<([^\s>]+)\b[^>]*>/gi)) {
      const tag = match[0];
      for (const attribute of tag.matchAll(/\b(alt|aria-label|title|placeholder)\s*=\s*(["'])(.*?)\2/gi)) {
        visible.push(attribute[3]);
      }
      if (/^<meta\b/i.test(tag) && /(?:property|name)\s*=\s*["'](?:og:title|og:site_name|description|application-name)["']/i.test(tag)) {
        const content = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i);
        if (content) visible.push(content[2]);
      }
    }
    assert.doesNotMatch(visible.join(' '), /\bsalemax\b/i, relativePath);
  }

  const website = fs.readFileSync(path.join(__dirname, '../client/public/website/index.html'), 'utf8');
  const applicationShell = fs.readFileSync(path.join(__dirname, '../client/public/index.html'), 'utf8');
  assert.match(website, /<title>7Network — Your business\. Connected\.<\/title>/);
  assert.match(applicationShell, /property="og:site_name"\s+content="7Network"/);
  assert.match(website, /https:\/\/crm\.salemax\.qa\//);
});

test('compact sidebar branding uses the approved 7Network icon and preserves full wordmarks elsewhere', () => {
  const script = fs.readFileSync(path.join(__dirname, '../client/public/7network-brand.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../client/public/7network-brand.css'), 'utf8');
  assert.match(script, /const compactBrand = Boolean\(img\.closest\('\.logo-box'\)\)/);
  assert.match(script, /const icon = compactBrand \|\|/);
  assert.match(script, /logo-dark\.png\?v=20261021-final-horizontal1/);
  assert.match(script, /logo-light\.png\?v=20261021-final-horizontal1/);
  assert.match(styles, /\.logo-box img\[data-seven-network-brand="icon"\][^{]*\{[^}]*width: 50px/);
  const source = fs.readFileSync(path.join(__dirname, '../client/public/branding/7network/logo-source.svg'), 'utf8');
  assert.match(source, /fill="#071A33">Netw<\/text>/);
  assert.match(source, /<image href="globe-no7-source\.png"/);
  assert.match(source, /fill="#071A33">rk<\/text>/);
  const exporter = fs.readFileSync(path.join(__dirname, '../scripts/export-7network-brand.cjs'), 'utf8');
  assert.match(exporter, /logo-horizontal-source\.png/);
  assert.match(exporter, /logo-dark-source\.png/);
  assert.match(exporter, /20261022-clear1/);
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
