'use strict';
const fs=require('node:fs'),path=require('node:path'),root=process.env.PWA_PUBLIC_ROOT||'/app/client/public',file=path.join(root,'index.html');
let html=fs.readFileSync(file,'utf8');
const old="if(matchMedia('(display-mode:standalone)').matches||matchMedia('(display-mode:minimal-ui)').matches||navigator.standalone===true)";
const next="if(matchMedia('(display-mode:standalone)').matches||matchMedia('(display-mode:minimal-ui)').matches||navigator.standalone===true||matchMedia('(max-width:700px)').matches)";
for(const [from,to,label] of [[old,next,'early splash activation'],['pwa-launch-splash.js?v=20261027-pwa-splash1','pwa-launch-splash.js?v=20261027-pwa-splash2','splash script cache key']]){
 const count=html.split(from).length-1;if(count!==1)throw Error(label+': expected one current anchor, got '+count);html=html.replace(from,to);
}
fs.writeFileSync(file,html);
