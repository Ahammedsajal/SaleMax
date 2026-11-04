#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [sourceRootArg, runtimeIndexArg, releaseRootArg] = process.argv.slice(2);
if (!sourceRootArg || !runtimeIndexArg || !releaseRootArg || !path.isAbsolute(releaseRootArg)) {
  console.error('Usage: node deploy/prepare-unified-agent-login.cjs <source-root> <runtime-index.html> <absolute-release-root>');
  process.exit(2);
}

const sourceRoot = path.resolve(sourceRootArg);
const runtimeIndex = path.resolve(runtimeIndexArg);
const releaseRoot = path.resolve(releaseRootArg);
if (fs.existsSync(releaseRoot)) throw new Error(`Refusing to overwrite release directory: ${releaseRoot}`);

const files = [
  'routes/user.js',
  'routes/agent.js',
  'modules/platform/agent-login-service.js',
  'client/public/unified-pwa-login.js',
  'deploy/compose.unified-agent-login.override.yml',
];
fs.mkdirSync(releaseRoot, { recursive: false, mode: 0o755 });
for (const relative of files) {
  const target = path.join(releaseRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  fs.copyFileSync(path.join(sourceRoot, relative), target);
}

let html = fs.readFileSync(runtimeIndex, 'utf8');
const tag = '<script src="/unified-pwa-login.js?v=20261103-role-aware1"></script>';
if (!html.includes(tag)) {
  const anchor = /<script\s+src=["']\/agent-workspace\.js\?v=[^"']+["']\s*>\s*<\/script>/i;
  if (!anchor.test(html)) throw new Error('Runtime shell has no agent-workspace hook; refusing to patch an unknown shell.');
  html = html.replace(anchor, `${tag}$&`);
}
const indexPath = path.join(releaseRoot, 'client/public/index.html');
fs.mkdirSync(path.dirname(indexPath), { recursive: true, mode: 0o755 });
fs.writeFileSync(indexPath, html, { mode: 0o644 });

for (const relative of files.concat('client/public/index.html')) {
  const content = fs.readFileSync(path.join(releaseRoot, relative));
  console.log(`${crypto.createHash('sha256').update(content).digest('hex')}  ${relative}`);
}
console.log(`release_root=${releaseRoot}`);
