'use strict';

const fs = require('node:fs');
const [indexFile, sidebarFile] = process.argv.slice(2);
if (!indexFile || !sidebarFile) {
  throw new Error('Usage: patch-tenant-ai-provider-profiles-cache.cjs <production-index.html> <production-training-sidebar.js>');
}

function replaceOne(file, previous, next) {
  let source = fs.readFileSync(file, 'utf8');
  const count = source.split(previous).length - 1;
  if (count === 0 && source.includes(next)) return;
  if (count !== 1) throw new Error(`Expected one production cache reference in ${file}; found ${count}`);
  source = source.replace(previous, next);
  fs.writeFileSync(file, source);
}

replaceOne(indexFile,
  '/training-sidebar.js?v=20261103-ai-integrations1',
  '/training-sidebar.js?v=20261104-ai-provider-profiles1');
replaceOne(indexFile,
  '/tenant-crm-appearance.js?v=20261103-ai-integrations1',
  '/tenant-crm-appearance.js?v=20261104-ai-provider-profiles1');
replaceOne(indexFile,
  '/ai-integrations.css?v=20261103-ai-integrations3',
  '/ai-integrations.css?v=20261104-ai-provider-profiles1');
replaceOne(indexFile,
  '/ai-integrations.js?v=20261103-ai-integrations3',
  '/ai-integrations.js?v=20261104-ai-provider-profiles1');
replaceOne(sidebarFile,
  '/chatbot-admin.js?v=20261103-ai-integrations1',
  '/chatbot-admin.js?v=20261104-ai-provider-profiles1');
