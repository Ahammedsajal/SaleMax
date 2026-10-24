'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('shared sidebar marks one shell logo and hides nested legacy brand duplicates', () => {
  const sidebar = read('client/public/training-sidebar.js');
  assert.match(sidebar, /brandText\?\.setAttribute\('data-sx-sidebar-brand-text','1'\)/);
  assert.match(sidebar, /candidate\.toggleAttribute\('data-sx-sidebar-duplicate-logo', candidate !== logo\)/);
  assert.match(sidebar, /\[data-sx-sidebar-brand-text\]\{display:none!important\}/);
  assert.match(sidebar, /\[data-sx-sidebar-duplicate-logo\]\{display:none!important\}/);
});

test('docked content reserves the measured sidebar width and profile/course overlays use it in either direction', () => {
  const sidebar = read('client/public/training-sidebar.js');
  const screens = read('client/public/training-courses.js');
  const shell = read('client/public/index.html');
  assert.match(sidebar, /getBoundingClientRect\(\)\.width/);
  assert.match(sidebar, /--sx-sidebar-docked-width/);
  assert.match(sidebar, /--sx-sidebar-inline-offset/);
  assert.doesNotMatch(screens, /#sx-(?:course-screen|training-profile-screen)\{[^}]*inset:64px 0 0 250px/);
  assert.doesNotMatch(screens, /#sx-(?:course-screen|training-profile-screen)\[dir=rtl\]\{inset-inline:250px 0/);
  assert.match(screens, /--sx-sidebar-inline-offset/);
  assert.match(shell, /training-sidebar\.js\?v=20261024-report-nav-stable1/);
  assert.match(shell, /training-courses\.js\?v=20261024-sidebar-layout1/);
});


test('production overlay carries the Lead Reports timezone helper from its reviewed release asset', () => {
  const dockerfile = read('deploy/Dockerfile.sidebar-layout-stability');
  const pipeline = read('client/public/pipeline/index.html');
  assert.match(dockerfile, /COPY --chown=node:node client\/public\/pipeline\/index\.html \/app\/client\/public\/pipeline\/index\.html/);
  assert.match(pipeline, /\/pipeline\/timezone-options\.js\?v=20261023-report-timezone1/);
  assert.match(dockerfile, /org\.7network\.base\.image/);
  assert.match(dockerfile, /org\.7network\.overlay\.commit/);
});


test('screen overlay copies the reviewed forms, finance, and Pipeline UI assets', () => {
  const dockerfile = read('deploy/Dockerfile.sidebar-layout-stability');
  for (const asset of [
    'training-forms.js', 'training-forms.css', 'training-finance.js', 'pipeline-entry.js',
    'pipeline/pipeline.css', 'pipeline/pipeline.js', 'pipeline/reports.js',
  ]) {
    assert.ok(dockerfile.includes(`client/public/${asset} /app/client/public/${asset}`), `overlay must copy ${asset}`);
  }
});

test('Lead Reports navigation is reconciled after sidebar deduplication and gated by access', () => {
  const sidebar = read('client/public/training-sidebar.js');
  const shell = read('client/public/index.html');
  const overlay = read('deploy/Dockerfile.lead-reports-nav');
  assert.match(sidebar, /function ensureLeadReportsRow\(list\)/);
  assert.match(sidebar, /roleNavigation\?\.has\('reports'\)/);
  assert.match(sidebar, /assignedNavigation!==null&&!assignedNavigation\.has\('reports'\)/);
  assert.match(sidebar, /ensureLeadReportsRow\(list\);/);
  assert.ok(sidebar.indexOf('ensureLeadReportsRow(list);') > sidebar.indexOf('dedupeSalesNavigationRows(list);'));
  assert.match(sidebar, /location\.href='\/user\?page=lead-reports'/);
  assert.match(shell, /training-sidebar\.js\?v=20261024-report-nav-stable1/);
  assert.match(overlay, /ARG BASE_IMAGE\nFROM \$\{BASE_IMAGE\}/);
  assert.match(overlay, /COPY --chown=node:node client\/public\/training-sidebar\.js/);
  assert.match(overlay, /COPY --chown=node:node client\/public\/pipeline\/reports\.js/);
  assert.doesNotMatch(overlay, /ARG BASE_IMAGE=/);
});

test('embedded Lead Reports route explicitly restores Reports mode and invalidates both cached shells', () => {
  const reports = read('client/public/pipeline/reports.js');
  const rootShell = read('client/public/index.html');
  const pipelineShell = read('client/public/pipeline/index.html');
  assert.match(reports, /function reportsRouteRequested\(\)/);
  assert.match(reports, /parentUrl\.searchParams\.get\('page'\)==='lead-reports'/);
  assert.match(reports, /if\(reportsRouteRequested\(\)\)\{setView\('reports'\);loadSchedules\(\);\}/);
  assert.match(rootShell, /training-sidebar\.js\?v=20261024-report-nav-stable1/);
  assert.match(pipelineShell, /pipeline\/reports\.js\?v=20261024-lead-reports-view1/);
});

test('cache helper preserves both production shells except for their versioned script URLs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '7network-sidebar-cache-'));
  const rootFile = path.join(directory, 'index.html');
  const pipelineFile = path.join(directory, 'pipeline.html');
  const originalRoot = '<html><body>live shell</body><script src="/training-sidebar.js?v=20261024-sidebar-layout1"></script><script src="/pipeline/reports.js?v=20261024-restored-screens1"></script></html>';
  const originalPipeline = '<html><body>live Pipeline</body><script src="/pipeline/reports.js?v=20261024-restored-screens1"></script></html>';
  try {
    fs.writeFileSync(rootFile, originalRoot);
    fs.writeFileSync(pipelineFile, originalPipeline);
    execFileSync(process.execPath, [path.join(root, 'deploy/bump-training-sidebar-cache.js'), rootFile, pipelineFile]);
    assert.equal(fs.readFileSync(rootFile, 'utf8'), originalRoot
      .replace('/training-sidebar.js?v=20261024-sidebar-layout1', '/training-sidebar.js?v=20261024-report-nav-stable1')
      .replace('/pipeline/reports.js?v=20261024-restored-screens1', '/pipeline/reports.js?v=20261024-lead-reports-view1'));
    assert.equal(fs.readFileSync(pipelineFile, 'utf8'), originalPipeline
      .replace('/pipeline/reports.js?v=20261024-restored-screens1', '/pipeline/reports.js?v=20261024-lead-reports-view1'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
