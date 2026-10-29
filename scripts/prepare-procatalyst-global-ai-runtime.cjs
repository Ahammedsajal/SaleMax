'use strict';

const fs = require('node:fs');
const path = require('node:path');

function assetVersion(html, asset) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...String(html).matchAll(new RegExp(`(?:src|href)=["']([^"']*${escaped}\\?v=)([^"']+)["']`, 'g'))];
  if (matches.length !== 1) throw new Error(`EXPECTED_ONE_ASSET_REFERENCE:${asset}`);
  return { prefix: matches[0][1], version: matches[0][2] };
}

function replaceAssetVersion(html, asset, version) {
  assetVersion(html, asset);
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`((?:src|href)=["'][^"']*${escaped}\\?v=)[^"']+(["'])`);
  return String(html).replace(expression, `$1${version}$2`);
}

function prepare({ liveIndex, liveSidebar, sourceIndex, sourceSidebar, outputDirectory }) {
  let index = String(liveIndex);
  let sidebar = String(liveSidebar);
  for (const asset of ['workspace-api.js', 'tenant-crm-appearance.js']) {
    const next = assetVersion(sourceIndex, asset).version;
    index = replaceAssetVersion(index, asset, next);
  }

  // Keep the exact live shell/sidebar fixes. Only change cache keys for the
  // new API/profile hooks and the chatbot editor loaded by the sidebar.
  index = replaceAssetVersion(index, 'training-sidebar.js', '20261029-procatalyst-ai1');
  const oldLoader = /chatbotScript\.src\s*=\s*(['"])\/chatbot-admin\.js\?v=[^'"]+\1/g;
  const targetLoader = String(sourceSidebar).match(/chatbotScript\.src\s*=\s*(['"])(\/chatbot-admin\.js\?v=[^'"]+)\1/);
  if (!targetLoader || [...sidebar.matchAll(oldLoader)].length !== 1) throw new Error('CHATBOT_ADMIN_LOADER_MISMATCH');
  sidebar = sidebar.replace(oldLoader, `chatbotScript.src = '${targetLoader[2]}'`);

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'index.html'), index);
  fs.writeFileSync(path.join(outputDirectory, 'training-sidebar.js'), sidebar);
  return {
    indexBytes: Buffer.byteLength(index),
    sidebarBytes: Buffer.byteLength(sidebar),
    workspaceApiVersion: assetVersion(index, 'workspace-api.js').version,
    profileVersion: assetVersion(index, 'tenant-crm-appearance.js').version,
    sidebarVersion: assetVersion(index, 'training-sidebar.js').version,
    chatbotEditorVersion: targetLoader[2].split('?v=')[1],
  };
}

if (require.main === module) {
  const [liveIndexPath, liveSidebarPath, sourceIndexPath, sourceSidebarPath, outputDirectory] = process.argv.slice(2);
  if (![liveIndexPath, liveSidebarPath, sourceIndexPath, sourceSidebarPath, outputDirectory].every(Boolean)) {
    console.error('Usage: node scripts/prepare-procatalyst-global-ai-runtime.cjs <live-index> <live-sidebar> <source-index> <source-sidebar> <output-directory>');
    process.exit(2);
  }
  const result = prepare({
    liveIndex: fs.readFileSync(liveIndexPath, 'utf8'),
    liveSidebar: fs.readFileSync(liveSidebarPath, 'utf8'),
    sourceIndex: fs.readFileSync(sourceIndexPath, 'utf8'),
    sourceSidebar: fs.readFileSync(sourceSidebarPath, 'utf8'),
    outputDirectory,
  });
  console.log(JSON.stringify(result));
}

module.exports = { assetVersion, replaceAssetVersion, prepare };
