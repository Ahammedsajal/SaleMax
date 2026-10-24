'use strict';
const fs = require('node:fs');
const [rootShell, pipelineShell] = process.argv.slice(2);
if (!rootShell || !pipelineShell) throw new Error('Expected the workspace and Pipeline shell paths');
function replaceVersion(file, oldRef, newRef) {
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes(newRef)) return;
  if (html.split(oldRef).length !== 2) throw new Error(`Expected exactly one current cache reference in ${file}`);
  fs.writeFileSync(file, html.replace(oldRef, newRef));
}
replaceVersion(rootShell,
  '/training-sidebar.js?v=20261024-sidebar-layout1',
  '/training-sidebar.js?v=20261024-report-nav-stable1');
const root = fs.readFileSync(rootShell, 'utf8');
const rootReportOld = '/pipeline/reports.js?v=20261024-restored-screens1';
const rootReportNew = '/pipeline/reports.js?v=20261024-lead-reports-view1';
if (root.includes(rootReportOld) || root.includes(rootReportNew)) {
  replaceVersion(rootShell, rootReportOld, rootReportNew);
}
replaceVersion(pipelineShell,
  '/pipeline/reports.js?v=20261024-restored-screens1',
  '/pipeline/reports.js?v=20261024-lead-reports-view1');
