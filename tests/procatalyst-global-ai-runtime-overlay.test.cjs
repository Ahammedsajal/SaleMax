'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare } = require('../scripts/prepare-procatalyst-global-ai-runtime.cjs');

test('runtime overlay keeps live shell/sidebar and changes only feature cache keys', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'procatalyst-global-ai-'));
  try {
    const liveIndex = '<script src="/workspace-api.js?v=live-api"></script><script defer src="/training-sidebar.js?v=live-sidebar"></script><script defer src="/tenant-crm-appearance.js?v=live-profile"></script><script src="/other.js?v=keep"></script>';
    const sourceIndex = '<script src="/workspace-api.js?v=source-api"></script><script defer src="/training-sidebar.js?v=source-sidebar"></script><script defer src="/tenant-crm-appearance.js?v=source-profile"></script>';
    const liveSidebar = "const keep='live-only-fix'; chatbotScript.src = '/chatbot-admin.js?v=live-editor';";
    const sourceSidebar = "chatbotScript.src = '/chatbot-admin.js?v=source-editor';";
    const result = prepare({ liveIndex, liveSidebar, sourceIndex, sourceSidebar, outputDirectory: temp });
    const index = fs.readFileSync(path.join(temp, 'index.html'), 'utf8');
    const sidebar = fs.readFileSync(path.join(temp, 'training-sidebar.js'), 'utf8');
    assert.match(index, /workspace-api\.js\?v=source-api/);
    assert.match(index, /training-sidebar\.js\?v=20261029-procatalyst-ai1/);
    assert.match(index, /tenant-crm-appearance\.js\?v=source-profile/);
    assert.match(index, /other\.js\?v=keep/);
    assert.match(sidebar, /live-only-fix/);
    assert.match(sidebar, /chatbot-admin\.js\?v=source-editor/);
    assert.equal(result.chatbotEditorVersion, 'source-editor');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('runtime overlay fails closed when any required live asset reference is ambiguous', () => {
  assert.throws(() => prepare({
    liveIndex: '<script src="/workspace-api.js?v=one"></script><script src="/workspace-api.js?v=two"></script>',
    liveSidebar: "chatbotScript.src='/chatbot-admin.js?v=old';",
    sourceIndex: '<script src="/workspace-api.js?v=next"></script><script src="/tenant-crm-appearance.js?v=next"></script>',
    sourceSidebar: "chatbotScript.src='/chatbot-admin.js?v=next';",
    outputDirectory: os.tmpdir(),
  }), /EXPECTED_ONE_ASSET_REFERENCE:workspace-api\.js/);
});
