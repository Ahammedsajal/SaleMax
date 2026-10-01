const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('preserved frontend references existing build assets and branding', () => {
  const publicRoot = path.join(root, 'client/public');
  const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'asset-manifest.json'), 'utf8'));
  for (const asset of Object.values(manifest.files)) assert.ok(fs.existsSync(path.join(publicRoot, asset)), 'Missing manifest asset');
  for (const match of html.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)) {
    if (match[1].startsWith('//')) continue;
    assert.ok(fs.existsSync(path.join(publicRoot, match[1].split(/[?#]/)[0])), 'Missing shell asset');
  }
  assert.ok(html.includes('SaleMaX'));
  assert.ok(fs.existsSync(path.join(publicRoot, 'media/salemax-logo.png')));
});
test('dependency lock matches declared runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
});
