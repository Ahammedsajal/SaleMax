'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../client/public/pipeline-entry.js'), 'utf8');
const start = source.indexOf('function workspaceBounds(){');
const end = source.indexOf('\n\n  function bindWorkspaceNavigation', start);
assert.ok(start >= 0 && end > start, 'workspaceBounds source is available');
const workspaceBoundsSource = source.slice(start, end);

function bounds({ width, height, visualViewport }) {
  const topbar = {
    getBoundingClientRect: () => ({ x: 0, y: 0, right: width, bottom: 50, width, height: 50 }),
    matches: selector => selector === '.MuiAppBar-root',
  };
  const document = {
    querySelectorAll: selector => selector === '.MuiDrawer-paper' ? [] : [topbar],
  };
  const context = {
    window: { innerWidth: width, innerHeight: height, visualViewport },
    document,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    visible: () => true,
  };
  return vm.runInNewContext(`(${workspaceBoundsSource.replace('function workspaceBounds', 'function')})()`, context);
}

test('embedded workspaces use the phone visual viewport when the layout viewport is desktop sized', () => {
  const result = bounds({
    width: 1180,
    height: 900,
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 390, height: 760 },
  });
  assert.deepEqual({ left: result.left, top: result.top, width: result.width, height: result.height }, {
    left: 0, top: 50, width: 390, height: 710,
  });
});

test('desktop workspace geometry remains based on the full layout viewport', () => {
  const result = bounds({ width: 1440, height: 900, visualViewport: null });
  assert.deepEqual({ left: result.left, top: result.top, width: result.width, height: result.height }, {
    left: 0, top: 50, width: 1440, height: 850,
  });
});

test('dashboard mobile styles stack panels and wrap metric values without changing desktop rules', () => {
  const css = fs.readFileSync(path.join(__dirname, '../client/public/business-dashboard/dashboard.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../client/public/business-dashboard/index.html'), 'utf8');
  assert.match(css, /@media\(max-width:600px\)[\s\S]*?\.main-grid,\.bottom-grid\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.metric-value\{[^}]*white-space:normal;overflow-wrap:anywhere/);
  assert.match(html, /dashboard\.css\?v=20261103-mobile-viewport1/);
});
