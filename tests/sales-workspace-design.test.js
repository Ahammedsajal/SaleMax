'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sections = [
  { directory: 'sales-workspace', style: 'sales-workspace.css' },
  { directory: 'sales-organization', style: 'sales-organization.css' },
  { directory: 'sales-commissions', style: 'sales-commissions.css' },
  { directory: 'sales-finance', style: 'sales-finance.css' },
  { directory: 'sales-audit', style: 'sales-audit.css' },
];
const tokenFile = path.join(root, 'client/public/sales-design-tokens.css');
const tokens = fs.readFileSync(tokenFile, 'utf8');

test('first-party Sales screens load the shared design tokens before section styles', () => {
  for (const { directory, style } of sections) {
    const html = fs.readFileSync(path.join(root, `client/public/${directory}/index.html`), 'utf8');
    const sharedIndex = html.indexOf('/sales-design-tokens.css?v=20261014-sales-ui1');
    const sectionIndex = html.search(new RegExp(`/${directory}/${style}\\?v=20261014-(?:sales-ui1|followups1|overview-alerts1|payout-batches1)`));
    assert.ok(sharedIndex >= 0, `${directory} should load the shared token stylesheet`);
    assert.ok(sectionIndex > sharedIndex, `${directory} styles should load after shared tokens`);
  }
});

test('Sales section styles use only defined shared design variables', () => {
  const defined = new Set([...tokens.matchAll(/(--sx-[a-z-]+)\s*:/g)].map(match => match[1]));
  const files = [
    path.join(root, 'client/public/sales-workspace/sales-workspace.css'),
    path.join(root, 'client/public/sales-workspace/sales-workspace-reports.css'),
    path.join(root, 'client/public/sales-organization/sales-organization.css'),
    path.join(root, 'client/public/sales-commissions/sales-commissions.css'),
    path.join(root, 'client/public/sales-finance/sales-finance.css'),
    path.join(root, 'client/public/sales-audit/sales-audit.css'),
  ];
  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8');
    for (const [, variable] of css.matchAll(/var\((--sx-[a-z-]+)/g)) {
      assert.ok(defined.has(variable), `${path.basename(file)} references undefined ${variable}`);
    }
    if (css.includes('.workspace{')) assert.match(css, /max-width:var\(--sx-content-width\)/);
  }
});

test('shared Sales tokens retain the existing burgundy brand and accessibility focus treatment', () => {
  assert.match(tokens, /--sx-brand:\s*#a8003b/i);
  assert.match(tokens, /--sx-brand-dark:\s*#85002f/i);
  assert.match(tokens, /a:focus-visible[\s\S]*outline:/);
  assert.match(tokens, /prefers-reduced-motion/);
});
