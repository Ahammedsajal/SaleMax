'use strict';

const fs = require('node:fs');
const [indexFile, sidebarFile] = process.argv.slice(2);
if (!indexFile || !sidebarFile) {
  throw new Error('Usage: patch-tenant-ai-provider-profiles-cache.cjs <production-index.html> <production-training-sidebar.js>');
}

function replaceVersion(file, previous, next) {
  let source = fs.readFileSync(file, 'utf8');
  const count = previous.reduce((total, value) => total + source.split(value).length - 1, 0);
  if (count === 0 && source.includes(next)) return;
  if (count !== 1) throw new Error(`Expected one production cache reference in ${file}; found ${count}`);
  for (const value of previous) {
    if (source.includes(value)) {
      source = source.replace(value, next);
      break;
    }
  }
  fs.writeFileSync(file, source);
}

replaceVersion(indexFile, [
  '/training-sidebar.js?v=20261103-ai-integrations1',
  '/training-sidebar.js?v=20261104-ai-provider-profiles1',
], '/training-sidebar.js?v=20261104-ai-provider-profiles2');
replaceVersion(indexFile, [
  '/tenant-crm-appearance.js?v=20261103-ai-integrations1',
  '/tenant-crm-appearance.js?v=20261104-ai-provider-profiles1',
], '/tenant-crm-appearance.js?v=20261104-ai-provider-profiles2');
replaceVersion(indexFile, [
  '/ai-integrations.css?v=20261103-ai-integrations3',
  '/ai-integrations.css?v=20261104-ai-provider-profiles1',
], '/ai-integrations.css?v=20261104-ai-provider-profiles2');
replaceVersion(indexFile, [
  '/ai-integrations.js?v=20261103-ai-integrations3',
  '/ai-integrations.js?v=20261104-ai-provider-profiles1',
], '/ai-integrations.js?v=20261104-ai-provider-profiles2');
replaceVersion(sidebarFile, [
  '/chatbot-admin.js?v=20261103-ai-integrations1',
  '/chatbot-admin.js?v=20261104-ai-provider-profiles1',
], '/chatbot-admin.js?v=20261104-ai-provider-profiles2');
