'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const patcher = path.join(__dirname, '../deploy/patch-tenant-ai-provider-profiles-cache.cjs');

test('production shell cache patch updates both screen loaders and is repeatable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '7network-provider-cache-'));
  try {
    const index = path.join(dir, 'index.html');
    const sidebar = path.join(dir, 'training-sidebar.js');
    fs.writeFileSync(index, '<script src="/training-sidebar.js?v=20261103-ai-integrations1"></script><script src="/tenant-crm-appearance.js?v=20261103-ai-integrations1"></script><link href="/ai-integrations.css?v=20261103-ai-integrations3"><script src="/ai-integrations.js?v=20261103-ai-integrations3"></script>');
    fs.writeFileSync(sidebar, "chatbotScript.src = '/chatbot-admin.js?v=20261103-ai-integrations1';");
    for (let i = 0; i < 2; i++) {
      const result = spawnSync(process.execPath, [patcher, index, sidebar], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.match(fs.readFileSync(index, 'utf8'), /training-sidebar\.js\?v=20261104-ai-provider-profiles1/);
    assert.match(fs.readFileSync(index, 'utf8'), /tenant-crm-appearance\.js\?v=20261104-ai-provider-profiles1/);
    assert.match(fs.readFileSync(index, 'utf8'), /ai-integrations\.css\?v=20261104-ai-provider-profiles1/);
    assert.match(fs.readFileSync(index, 'utf8'), /ai-integrations\.js\?v=20261104-ai-provider-profiles1/);
    assert.match(fs.readFileSync(sidebar, 'utf8'), /chatbot-admin\.js\?v=20261104-ai-provider-profiles1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('production shell cache patch refuses an unknown shell version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '7network-provider-cache-'));
  try {
    const index = path.join(dir, 'index.html');
    const sidebar = path.join(dir, 'training-sidebar.js');
    fs.writeFileSync(index, '<script src="/training-sidebar.js?v=unexpected"></script>');
    fs.writeFileSync(sidebar, "chatbotScript.src = '/chatbot-admin.js?v=20261103-ai-integrations1';");
    const result = spawnSync(process.execPath, [patcher, index, sidebar], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provider release overlay refreshes the main shell integrations restored from the current baseline', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '../deploy/compose.tenant-ai-provider-profiles.override.yml'), 'utf8');
  for (const file of [
    'client/public/chatbot-admin.js',
    'client/public/index.html',
    'client/public/tenant-crm-appearance.js',
    'client/public/training-sidebar.js',
    'client/public/ai-integrations.js',
    'client/public/ai-integrations.css',
    'modules/platform/tenant-ai-settings.js',
    'modules/platform/tenant-ai-settings-router.js',
    'database/migrations/20270120_chatbot_provider_profiles.sql',
  ]) assert.ok(overlay.includes(`${file}:/app/${file}:ro`), `missing production mount for ${file}`);
});
