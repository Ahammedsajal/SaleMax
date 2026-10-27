'use strict';
const fs=require('node:fs'),path=require('node:path'),root=process.env.MOBILE_ASSET_ROOT||'/app/client/public',p=path.join(root,'index.html');
let html=fs.readFileSync(p,'utf8');
if(html.includes('mobile-inbox-composer.css?v=20261027-compact1')||html.includes('mobile-inbox-composer.js?v=20261027-compact1'))throw Error('Inbox composer assets already linked');
const n=html.split('</head>').length-1;if(n!==1)throw Error('Expected one app shell head, got '+n);
html=html.replace('</head>','<link rel="stylesheet" href="/mobile-inbox-composer.css?v=20261027-compact1"><script defer src="/mobile-inbox-composer.js?v=20261027-compact1"></script></head>');
fs.writeFileSync(p,html);
