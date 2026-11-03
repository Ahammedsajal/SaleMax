'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [repoRoot, productionShell, releaseRoot] = process.argv.slice(2);
if (!repoRoot || !productionShell || !releaseRoot) {
  throw new Error('Usage: node prepare-mobile-dashboard-agent-login-release.cjs <repo-root> <production-shell> <release-root>');
}

const copy = (source, target) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, source), target);
};

const runtime = path.join(releaseRoot, 'runtime');
const files = [
  ['client/public/pipeline-entry.js', 'client/public/pipeline-entry.js'],
  ['client/public/business-dashboard/index.html', 'client/public/business-dashboard/index.html'],
  ['client/public/business-dashboard/dashboard.css', 'client/public/business-dashboard/dashboard.css'],
  ['routes/user.js', 'routes/user.js'],
  ['modules/platform/unified-agent-login-policy.js', 'modules/platform/unified-agent-login-policy.js'],
];
for (const [source, target] of files) copy(source, path.join(runtime, target));

const shell = fs.readFileSync(productionShell, 'utf8');
const before = 'pipeline-entry.js?v=20261023-pipeline-report-sidebar-fix1';
const after = 'pipeline-entry.js?v=20261103-visual-viewport1';
if (shell.split(before).length !== 2) throw new Error('Expected exactly one current production pipeline-entry cache reference');
fs.mkdirSync(path.join(runtime, 'client/public'), { recursive: true });
fs.writeFileSync(path.join(runtime, 'client/public/index.html'), shell.replace(before, after));

fs.mkdirSync(path.join(releaseRoot, 'deploy'), { recursive: true });
fs.copyFileSync(path.join(repoRoot, 'deploy/compose.mobile-dashboard-agent-login.override.yml'), path.join(releaseRoot, 'deploy/compose.mobile-dashboard-agent-login.override.yml'));
console.log(`Prepared runtime overlay at ${releaseRoot}`);
