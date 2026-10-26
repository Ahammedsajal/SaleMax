'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/app';
const file = path.join(root, 'client/public/index.html');
const source = '/salemax-mobile.css?v=20261026-sidebar-mobile1';
let html = fs.readFileSync(file, 'utf8');
html = html.replace(/<link\b[^>]*href=["'][^"']*salemax-mobile\.css[^"']*["'][^>]*>/gi, '');
const headEnd = html.toLowerCase().lastIndexOf('</head>');
if (headEnd < 0) throw Error('MOBILE_SIDEBAR_SHELL_HEAD_MISSING');
html = html.slice(0, headEnd) + `<link rel="stylesheet" href="${source}">` + html.slice(headEnd);
fs.writeFileSync(file, html);
