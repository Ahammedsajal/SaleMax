'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sidebar = fs.readFileSync(path.join(__dirname, '../client/public/training-sidebar.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../client/public/index.html'), 'utf8');

test('expanded sidebar uses a usable overlay on narrow screens in both text directions', () => {
  assert.match(sidebar, /@media\(max-width:700px\)\s*\{[\s\S]*?\.MuiDrawer-root\.MuiDrawer-docked:has\(>\.MuiDrawer-paper:not\(\[data-sx-sidebar-collapsed\]\)\)\{position:fixed!important;[\s\S]*?inset-inline-start:0!important;[\s\S]*?width:min\(280px,calc\(100vw - 48px\)\)!important/);
  assert.match(sidebar, /\.MuiDrawer-paper:not\(\[data-sx-sidebar-collapsed\]\)\{[\s\S]*?overflow-y:auto!important/);
  assert.match(sidebar, /\[data-sx-sidebar-collapsed\] \[data-sx-nav-section\]\{display:none!important\}/);
});

test('narrow-screen sidebar fix is cache-busted in the existing app shell', () => {
  assert.match(index, /training-sidebar\.js\?v=20261020-sidebar-mobile-overlay1/);
});
