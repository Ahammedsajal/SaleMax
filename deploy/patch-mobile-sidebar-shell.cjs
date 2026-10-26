'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/app';
const file = path.join(root, 'client/public/index.html');
const source = '/7network-mobile.css?v=20261026-mobile-drawer-brand1';
let html = fs.readFileSync(file, 'utf8');
html = html.replace(/<link\b[^>]*href=["'][^"']*(?:salemax|7network)-mobile\.css[^"']*["'][^>]*>/gi, '');
const headEnd = html.toLowerCase().lastIndexOf('</head>');
if (headEnd < 0) throw Error('MOBILE_SIDEBAR_SHELL_HEAD_MISSING');
html = html.slice(0, headEnd) + `<link rel="stylesheet" href="${source}">` + html.slice(headEnd);
fs.writeFileSync(file, html);
