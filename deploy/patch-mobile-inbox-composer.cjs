'use strict';
const fs=require('node:fs'),path=require('node:path'),root=process.env.MOBILE_ASSET_ROOT||'/app/client/public',p=path.join(root,'index.html');
let html=fs.readFileSync(p,'utf8');
for(const name of ['mobile-inbox-composer.css','mobile-inbox-composer.js']){
 const old=`${name}?v=20261027-compact1`,next=`${name}?v=20261027-compact2`,count=html.split(old).length-1;
 if(count!==1)throw Error(`${name}: expected one previous asset link, got ${count}`);
 html=html.replace(old,next);
}
fs.writeFileSync(p,html);
