const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'client/workspace-src');
const target=path.join(root,'client/.preview-build');
fs.mkdirSync(target,{recursive:true});
const files=['index.html','workspace.js','workspace.css','signin.html','signin.js','signin.css'];
const manifest={mode:'TC01 synthetic design preview; not production workflows',files:{}};
for(const file of files){const bytes=fs.readFileSync(path.join(source,file));fs.writeFileSync(path.join(target,file),bytes);manifest.files[file]=crypto.createHash('sha256').update(bytes).digest('hex');}
fs.copyFileSync(path.join(root,'client/public/media/salemax-logo.png'),path.join(target,'brand.png'));
manifest.files['brand.png']=crypto.createHash('sha256').update(fs.readFileSync(path.join(target,'brand.png'))).digest('hex');
fs.writeFileSync(path.join(target,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({source:'client/workspace-src',output:'client/.preview-build',files:files.length+1}));
