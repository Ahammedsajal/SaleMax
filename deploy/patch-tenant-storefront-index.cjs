'use strict';

const fs = require('node:fs');

const target = process.argv[2] || '/app/client/public/index.html';
const source = fs.readFileSync(target, 'utf8');
const tag = '<script defer src="/tenant-storefront-settings.js?v=20261026-single-tenant-storefront1"></script>';
if (source.includes(tag)) process.exit(0);

const marker = '<script defer="defer" src="/tenant-crm-appearance.js?v=20270103-business-sidebar-logo1"></script>';
if (source.split(marker).length !== 2) {
  throw new Error('Expected exactly one current tenant CRM appearance script');
}

fs.writeFileSync(target, source.replace(marker, marker + tag));
