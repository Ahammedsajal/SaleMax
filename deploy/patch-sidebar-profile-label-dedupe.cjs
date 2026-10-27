#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const releaseRoot = process.argv[2];
if (!releaseRoot) {
  console.error('Usage: node patch-sidebar-profile-label-dedupe.cjs <release-root>');
  process.exit(2);
}

const sidebarPath = path.join(releaseRoot, 'client/public/training-sidebar.js');
const indexPath = path.join(releaseRoot, 'client/public/index.html');
let sidebar = fs.readFileSync(sidebarPath, 'utf8');
let index = fs.readFileSync(indexPath, 'utf8');

const oldCheck = 'const hasVisibleText=hasVisibleSidebarText(row);';
const newCheck = [
  '// Prefer existing React/tenant labels when populated. Profile-menu reflows can',
  '// briefly hide native text geometry and otherwise leave a fallback beside it.',
  "const nativeText=row.querySelector('.sx-tenant-navigation-label, .MuiListItemText-primary');",
  'const hasNativeLabel=!!nativeText?.textContent?.trim();'
].join('\n            ');
const oldCondition = 'if(!hasVisibleText&&tooltip){';
const newCondition = 'if(!hasNativeLabel&&tooltip){';
if (sidebar.includes(oldCheck) && sidebar.includes(oldCondition)) {
  sidebar = sidebar.replace(oldCheck, newCheck).replace(oldCondition, newCondition);
} else if (!(sidebar.includes('const hasNativeLabel=!!nativeText?.textContent?.trim();') && sidebar.includes(newCondition))) {
  throw new Error('Sidebar hook does not match the expected pre-patch or patched form; refusing to edit.');
}

const assetPattern = /\/training-sidebar\.js\?v=[^"']+/g;
const matches = [...index.matchAll(assetPattern)];
if (matches.length !== 1) throw new Error(`Expected one sidebar asset URL, found ${matches.length}.`);
index = index.replace(assetPattern, '/training-sidebar.js?v=20261027-profile-label-dedupe1');
const composePath = path.join(releaseRoot, 'deploy/compose.sidebar-profile-label-dedupe.override.yml');
const compose = [
  'services:',
  '  app:',
  '    volumes:',
  '      - type: bind',
  `        source: ${indexPath}`,
  '        target: /app/client/public/index.html',
  '        read_only: true',
  '      - type: bind',
  `        source: ${sidebarPath}`,
  '        target: /app/client/public/training-sidebar.js',
  '        read_only: true',
  ''
].join('\n');
fs.writeFileSync(sidebarPath, sidebar);
fs.writeFileSync(indexPath, index);
fs.writeFileSync(composePath, compose);
