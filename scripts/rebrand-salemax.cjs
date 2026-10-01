// Rebrand the supplied compiled training copy without changing integration contracts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const backup = path.join(root, 'private-backups', 'rebrand-20260930');
const changed = [];
function write(rel, value) {
  const file = path.join(root, rel);
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file);
    if (old.equals(Buffer.from(value))) return;
    const dest = path.join(backup, rel);
    if (!fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(file, dest); }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value); changed.push(rel);
}
function brand(s) {
  return s.replace(/info@gccbot\.com/gi, 'info@salemax.qa')
    .replace(/\b(?:GCCBOT|GCC BOT|GC-Connect|GBOT|WhatsCRM|AI Influencer)\b/gi, 'SaleMaX');
}
for (const file of fs.readdirSync(path.join(root, 'languages')).filter(x => x.endsWith('.json'))) {
  const rel = 'languages/' + file;
  write(rel, brand(fs.readFileSync(path.join(root, rel), 'utf8')));
}
const publicDir = path.join(root, 'client/public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'asset-manifest.json')));
const oldMain = manifest.files['main.js'];
let js = fs.readFileSync(path.join(publicDir, oldMain), 'utf8');
js = js.replace(/"https:\/\/gccbot\.com"/g, 'window.location.origin');
js = brand(js);
// Brand palette only in the application portion; leave bundled vendor code intact.
const cut = js.indexOf('l=window.location.origin');
if (cut < 0) throw new Error('Could not locate compiled application boundary');
const colors = {'#00A884':'#A8003B','#0D9276':'#85002F','#25D366':'#B50B49','#128C7E':'#85002F','#075E54':'#560020'};
const recolor = s => {
  for (const [from,to] of Object.entries(colors)) s=s.replace(new RegExp(from,'gi'),to);
  return s.replace(/rgba\(37,\s*211,\s*102,/g,'rgba(168,0,59,').replace(/rgba\(0,\s*168,\s*132,/g,'rgba(168,0,59,');
};
js = js.slice(0,cut) + recolor(js.slice(cut));
// Keep rotating hero subjects within the brand palette; semantic statuses retain their colors.
js = js.replace('O=null!==(n=null===(o=d.palette[x.color])||void 0===o?void 0:o.main)&&void 0!==n?n:z.main,y=null!==(r=null===(a=d.palette[x.color])||void 0===a?void 0:a.light)&&void 0!==r?r:z.light','O=z.main,y="dark"===d.palette.mode?"#F4A1BE":z.light');
js = js.replace('(0,Dt.jsx)(no,{sx:{width:44,height:44,borderRadius:2,bgcolor:"primary.main",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,Dt.jsx)(Np,{sx:{color:"primary.contrastText",fontSize:24}})}),(0,Dt.jsx)(Tl,{variant:"h6",fontWeight:700,color:"text.primary",letterSpacing:-.3,children:null===a||void 0===a?void 0:a.appName})', '(0,Dt.jsx)(no,{component:"img",src:"/media/salemax-logo.png",alt:"SaleMaX",sx:{width:220,maxWidth:"100%",height:"auto",objectFit:"contain",backgroundColor:"#fff",borderRadius:2,p:1}})');
// Compact shell and loader slots consume the square icon rather than a tiny wordmark.
js = js.replace('src:"/media/".concat(n.logo),alt:', 'src:"/media/salemax-icon.png",alt:');
js = js.replace('src:"/media/".concat(z.logo),alt:', 'src:"/media/salemax-icon.png",alt:');
const newMain = '/static/js/main.' + crypto.createHash('sha256').update(js).digest('hex').slice(0,8) + '.js';
write('client/public' + newMain, js);
manifest.files['main.js'] = newMain;
manifest.entrypoints = manifest.entrypoints.map(x => '/' + x === oldMain ? newMain.slice(1) : x);
write('client/public/asset-manifest.json', JSON.stringify(manifest,null,2)+'\n');
let html = fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
html = html.replace(oldMain,newMain).replace(/\?v=20260930-footer-centered/g,'?v=salemax-20260930')
  .replace('<title>GC-Connect</title>','<title>SaleMaX | Business Messaging & Automation</title>')
  .replace('content="Web site created using create-react-app"','content="SaleMaX brings business messaging, AI chatbots, campaigns, and customer conversations into one workspace."')
  .replace('content="#000000"','content="#A8003B"');
if (!html.includes('/salemax-brand.css')) html=html.replace('</head>','<link rel="stylesheet" href="/salemax-brand.css?v=20260930"/><link rel="canonical" href="https://salemax.qa/"/><meta property="og:site_name" content="SaleMaX"/><meta property="og:title" content="SaleMaX | Business Messaging & Automation"/><meta property="og:url" content="https://salemax.qa/"/></head>');
write('client/public/index.html', html);
write('client/public/salemax-brand.css', '.logo-box + .brand-text{display:none!important}.logo-box{height:48px!important;max-width:200px;background:#fff!important;border-radius:8px;padding:3px 8px}.logo-box img{object-fit:contain!important}img[src="/media/salemax-logo.png"]{object-fit:contain!important;background:#fff;border-radius:8px} .MuiDrawer-paper img[src="/media/salemax-logo.png"]{max-width:180px} @media(max-width:600px){.logo-box{height:38px!important;max-width:150px}}\n');
const pwa = JSON.parse(fs.readFileSync(path.join(publicDir,'manifest.json')));
pwa.name='SaleMaX — Business Messaging'; pwa.short_name='SaleMaX'; pwa.theme_color='#A8003B';
write('client/public/manifest.json',JSON.stringify(pwa,null,2)+'\n');
for (const rel of ['client/public/pipeline/index.html','client/public/pipeline/pipeline.js','LOCAL-RUN.md','README.md','start-local.ps1','stop-local.ps1','app.js','server.js']) {
  write(rel, brand(fs.readFileSync(path.join(root,rel),'utf8')).replace('WaCrm server','SaleMaX server').replace('GC<span>BOT</span>','Sale<span>MaX</span>'));
}
write('client/public/pipeline/pipeline.css',fs.readFileSync(path.join(publicDir,'pipeline/pipeline.css'),'utf8').replace(/#(?:08a885|0aa889|0a9b7c)/gi,'#a8003b'));
write('client/public/app-switcher.js',fs.readFileSync(path.join(publicDir,'app-switcher.js'),'utf8').replace('#087f6b','#a8003b'));
write('emails/returnEmails.js',fs.readFileSync(path.join(root,'emails/returnEmails.js'),'utf8').replace('#007bff','#A8003B'));
const theme = recolor(fs.readFileSync(path.join(root,'routes/themes/theme-wa-new.json'),'utf8'));
if (!fs.existsSync(path.join(root, 'routes/themes/theme-salemax.json'))) write('routes/themes/theme-salemax.json',theme);
write('routes/themes/active-theme.json',JSON.stringify({activeThemeId:'theme-salemax'},null,2)+'\n');
const registry=JSON.parse(fs.readFileSync(path.join(root,'routes/themes/themes-registry.json')));
if(!registry.themes.some(t=>t.id==='theme-salemax')) registry.themes.push({id:'theme-salemax',name:'SaleMaX',description:'Burgundy, charcoal, and silver SaleMaX brand palette',isProtected:false,createdAt:'2026-09-30T00:00:00.000Z',updatedAt:'2026-09-30T00:00:00.000Z'});
write('routes/themes/themes-registry.json',JSON.stringify(registry,null,2)+'\n');
for(const rel of ['package.json','package-lock.json']) {
  const pkg=JSON.parse(fs.readFileSync(path.join(root,rel)));
  pkg.name='salemax-node';
  if(pkg.packages?.[''])pkg.packages[''].name='salemax-node';
  if(rel==='package.json') pkg.description='SaleMaX business messaging and automation platform';
  write(rel,JSON.stringify(pkg,null,2)+'\n');
}
console.log(JSON.stringify({changed,activeBundle:newMain},null,2));

