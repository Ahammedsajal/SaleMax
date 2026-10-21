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
  { directory: 'call-center', style: 'call-center.css' },
  { directory: 'tasks', style: 'tasks.css' },
];
const tokenFile = path.join(root, 'client/public/sales-design-tokens.css');
const tokens = fs.readFileSync(tokenFile, 'utf8');

test('first-party Sales screens load the shared design tokens before section styles', () => {
  for (const { directory, style } of sections) {
    const html = fs.readFileSync(path.join(root, `client/public/${directory}/index.html`), 'utf8');
    const sharedIndex = html.indexOf('/sales-design-tokens.css?v=20261014-sales-ui2');
    const sectionIndex = html.search(new RegExp(`/${directory}/${style}\\?v=20[0-9]{6}-[^" ]+`));
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

test('Organization role badges use the shared galaxy-blue and neutral palette', () => {
  const css = fs.readFileSync(path.join(root, 'client/public/sales-organization/sales-organization.css'), 'utf8');
  assert.match(css, /\.role-badge\.owner\{background:var\(--sx-brand\);color:var\(--sx-surface\)\}/);
  assert.match(css, /\.role-badge\.manager\{background:var\(--sx-brand-pill-bg\);color:var\(--sx-brand-dark\)\}/);
  assert.match(css, /\.role-badge\.team_leader\{background:var\(--sx-brand-soft\);color:var\(--sx-brand-dark\)\}/);
  assert.match(css, /\.role-badge\.agent\{background:var\(--sx-surface\);color:var\(--sx-brand-dark\)/);
  assert.match(css, /\.role-badge\.accountant\{background:var\(--sx-canvas\);color:var\(--sx-label\)/);
  assert.doesNotMatch(css, /\.role-badge\.(?:manager|team_leader|agent|accountant)\{background:#/i);
});

test('shared Sales tokens use the 7Network galaxy-blue brand and accessible focus treatment', () => {
  assert.match(tokens, /--sx-brand:\s*#1768d4/i);
  assert.match(tokens, /--sx-brand-dark:\s*#0d4fae/i);
  assert.match(tokens, /--sx-page-padding:\s*26px 24px 44px/);
  assert.match(tokens, /--sx-page-padding-mobile:\s*17px 13px 28px/);
  assert.match(tokens, /--sx-focus-ring:\s*rgb\(23 104 212 \/ 28%\)/);
  assert.match(tokens, /a:focus-visible[\s\S]*outline:/);
  assert.match(tokens, /prefers-reduced-motion/);
});

test('Sales-only workspaces share desktop and mobile page gutters', () => {
  const files = [
    'sales-workspace/sales-workspace.css',
    'sales-organization/sales-organization.css',
    'sales-commissions/sales-commissions.css',
    'sales-finance/sales-finance.css',
    'sales-audit/sales-audit.css',
  ];
  for (const file of files) {
    const css = fs.readFileSync(path.join(root, `client/public/${file}`), 'utf8');
    assert.match(css, /\.workspace\{[^}]*padding:var\(--sx-page-padding\)/, `${file} should use the shared desktop gutter`);
    assert.match(css, /\.workspace\{padding:var\(--sx-page-padding-mobile\)\}/, `${file} should use the shared mobile gutter`);
  }
});

test('Call Center browser chrome and mobile spacing follow the shared Sales theme', () => {
  const html = fs.readFileSync(path.join(root, 'client/public/call-center/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/public/call-center/call-center.css'), 'utf8');
  assert.match(html, /theme-color" content="#1768d4"/i);
  assert.match(html, /call-center\/call-center\.css\?v=20261014-sales-call-outcome-review1/);
  assert.match(css, /header\{align-items:flex-start\}/);
  assert.match(css, /color:var\(--sx-brand\)/);
  assert.match(css, /background:var\(--sx-canvas\)/);
});

test('Tasks page aligns its shared queue layout and browser theme to the Sales workspace', () => {
  const html = fs.readFileSync(path.join(root, 'client/public/tasks/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/public/tasks/tasks.css'), 'utf8');
  assert.match(html, /theme-color" content="#1768d4"/i);
  assert.match(html, /sales-design-tokens\.css[\s\S]*tasks\/tasks\.css/);
  assert.match(css, /max-width:var\(--sx-content-width\)/);
  assert.match(css, /color:var\(--sx-brand\)/);
  assert.match(css, /background:var\(--sx-canvas\)/);
});
