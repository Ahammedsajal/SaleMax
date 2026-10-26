'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || '/app');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value);

function moveFile(oldName, newName, { sameContentOnly = false } = {}) {
  const from = path.join(root, oldName);
  const to = path.join(root, newName);
  if (!fs.existsSync(from)) return;
  if (fs.existsSync(to)) {
    if (sameContentOnly && !fs.readFileSync(from).equals(fs.readFileSync(to))) {
      throw new Error(`BRAND_FILENAME_COLLISION:${oldName}:${newName}`);
    }
    fs.rmSync(from, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function patchFile(relative, edit) {
  if (!exists(relative)) return;
  const before = read(relative);
  const after = edit(before);
  if (after !== before) write(relative, after);
}

// Move the live image's own assets and documents without replacing live-only content.
for (const [oldName, newName, options] of [
  ['client/public/salemax-brand.css', 'client/public/7network-shell-brand.css'],
  ['client/public/salemax-homepage-copy.js', 'client/public/7network-homepage-copy.js'],
  ['client/public/media/salemax-logo.png', 'client/public/media/7network-logo.png', { sameContentOnly: true }],
  ['client/public/media/salemax-icon.png', 'client/public/media/7network-icon.png', { sameContentOnly: true }],
  ['routes/themes/theme-salemax.json', 'routes/themes/theme-7network.json'],
  ['deploy/salemax-https.service', 'deploy/7network-https.service'],
  ['deploy/salemax-https.timer', 'deploy/7network-https.timer'],
  ['docs/SALEMAX_TRAINING_CENTER_IMPLEMENTATION_PLAN.docx', 'docs/7NETWORK_TRAINING_CENTER_IMPLEMENTATION_PLAN.docx'],
  ['docs/SALEMAX_TRAINING_CENTER_IMPLEMENTATION_PLAN.md', 'docs/7NETWORK_TRAINING_CENTER_IMPLEMENTATION_PLAN.md'],
  ['scripts/rebrand-salemax.cjs', 'scripts/rebrand-7network.cjs'],
]) moveFile(oldName, newName, options || {});

const oldDir = path.join(root, 'salemax');
const newDir = path.join(root, '7network');
if (fs.existsSync(oldDir)) {
  if (fs.existsSync(newDir)) throw new Error('BRAND_DIRECTORY_COLLISION:salemax:7network');
  // The legacy directory can be on a separate overlay mount in the base image.
  fs.cpSync(oldDir, newDir, { recursive: true, preserveTimestamps: true, errorOnExist: true });
  fs.rmSync(oldDir, { recursive: true, force: false });
}

const mobileCss = path.join(root, 'client/public/7network-mobile.css');
if (!fs.existsSync(mobileCss)) throw new Error('CANONICAL_MOBILE_STYLESHEET_MISSING');
fs.rmSync(path.join(root, 'client/public/salemax-mobile.css'), { force: true });

// Keep old URL contracts alive as in-process aliases after removing old files.
const serverPath = path.join(root, 'server.js');
let server = read('server.js');
const mediaMount = 'app.use("/media", createMediaMiddleware("./client/public/media"));';
const aliasBlock = `// Keep legacy static URLs working for cached shells and saved logo paths.\nconst legacyPlatformAssetAliases = new Map([\n  ["/salemax-mobile.css", "7network-mobile.css"],\n  ["/salemax-brand.css", "7network-shell-brand.css"],\n  ["/salemax-homepage-copy.js", "7network-homepage-copy.js"],\n  ["/media/salemax-logo.png", "media/7network-logo.png"],\n  ["/media/salemax-icon.png", "media/7network-icon.png"],\n]);\napp.get([...legacyPlatformAssetAliases.keys()], (req, res) => {\n  res.sendFile(path.resolve(publicDir, legacyPlatformAssetAliases.get(req.path)));\n});\n\n`;
if (!server.includes('legacyPlatformAssetAliases')) {
  if (server.split(mediaMount).length !== 2) throw new Error('MEDIA_MOUNT_PATCH_POINT_MISSING');
  server = server.replace(mediaMount, `${aliasBlock}${mediaMount}`);
  write('server.js', server);
}

// Preserve the legacy theme ID used by active-theme.json and existing API clients.
patchFile('routes/theme.js', (source) => {
  if (source.includes('THEME_FILE_ALIASES')) return source;
  const old = 'const themeFilePath = (id) => path.join(THEMES_DIR, `${id}.json`);';
  if (!source.includes(old)) throw new Error('THEME_PATH_PATCH_POINT_MISSING');
  return source.replace(old, 'const THEME_FILE_ALIASES = new Map([["theme-salemax", "theme-7network"]]);\nconst themeFilePath = (id) => path.join(THEMES_DIR, `${THEME_FILE_ALIASES.get(id) || id}.json`);');
});

patchFile('client/public/index.html', (html) => {
  html = html.replace(/<link\b[^>]*href=["'][^"']*\/salemax-brand\.css[^"']*["'][^>]*>/gi, '');
  if (!/href=["']\/7network-shell-brand\.css(?:[?"'])/i.test(html)) {
    html = html.replace(/<\/head>/i, '<link rel="stylesheet" href="/7network-shell-brand.css?v=20261026-brand-file1"></head>');
  }
  html = html.replace(/\/salemax-homepage-copy\.js(?:\?[^"']*)?/g, '/7network-homepage-copy.js?v=20261026-brand-file1');
  html = html.replace(/<link\b[^>]*href=["'][^"']*(?:salemax|7network)-mobile\.css[^"']*["'][^>]*>/gi, '');
  return html.replace(/<\/head>/i, '<link rel="stylesheet" href="/7network-mobile.css?v=20261026-mobile-drawer-brand1"></head>');
});

for (const [relative, replacements] of [
  ['client/public/7network-shell-brand.css', [['/media/salemax-logo.png', '/media/7network-logo.png']]],
  ['scripts/build-workspace.cjs', [['media/salemax-logo.png', 'media/7network-logo.png']]],
  ['scripts/export-7network-brand.cjs', [['salemax-logo.png', '7network-logo.png'], ['salemax-icon.png', '7network-icon.png']]],
  ['scripts/rebrand-local-data.cjs', [['SaleMaX', '7Network'], ['salemax-logo.png', '7network-logo.png']]],
  ['scripts/existing-panel-lab.cjs', [['SaleMaX · Synthetic test', '7Network · Synthetic test'], ['salemax-logo.png', '7network-logo.png']]],
  ['tests/baseline.test.js', [['media/salemax-logo.png', 'media/7network-logo.png']]],
  ['tests/training-center-logo-media.test.js', [['salemax-logo-test-', '7network-logo-test-']]],
  ['AGENTS.md', [['SALEMAX_TRAINING_CENTER_IMPLEMENTATION_PLAN.md', '7NETWORK_TRAINING_CENTER_IMPLEMENTATION_PLAN.md']]],
]) patchFile(relative, (source) => replacements.reduce((text, [from, to]) => text.replaceAll(from, to), source));

for (const file of ['tests/training-finance-layout.test.js', 'tests/training-finance-policies.test.js', 'tests/training-installment-reminders.test.js', 'tests/training-invoices.test.js']) {
  patchFile(file, (source) => source.replaceAll('salemax-brand.css', '7network-shell-brand.css'));
}

patchFile('deploy/7network-https.timer', (source) => source.replaceAll('salemax-https.service', '7network-https.service'));
patchFile('deploy/7network-https.service', (source) => source.replaceAll('Salemax HTTPS', '7Network HTTPS'));
patchFile('deploy/activate-https.sh', (source) => source
  .replaceAll('/run/salemax-https.lock', '/run/7network-https.lock')
  .replace('systemctl disable --now salemax-https.timer', 'systemctl disable --now 7network-https.timer 2>/dev/null || true\nsystemctl disable --now salemax-https.timer 2>/dev/null || true'));

// This one-time legacy migration must not recreate the former brand files.
if (exists('scripts/rebrand-7network.cjs')) {
  write('scripts/rebrand-7network.cjs', `'use strict';\nthrow new Error('Historical migration script; use export-7network-brand.cjs.');\n`);
}

console.log(JSON.stringify({ renamed: true, legacyAssetAliases: 5 }));
