'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const businessProfile=require('./tenant-business-profile');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safePath=value=>typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\r\n]/.test(value)?value:'';
function setMeta(html,attribute,key,value){
 const safe=escapeHtml(value),tag=`<meta ${attribute}="${escapeHtml(key)}" content="${safe}"/>`,pattern=new RegExp(`<meta\\s+${attribute}="${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"[^>]*>`,'i');
 return pattern.test(html)?html.replace(pattern,tag):html.replace(/<\/head>/i,`${tag}</head>`);
}
function publicAsset(value){
 const local=safePath(value);if(local)return local;
 try{const parsed=new URL(value);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)return parsed.toString();}catch{}
 return '';
}
function renderShell(source,profile,{hostname,pathname='/user/login',arabic=false}={}){
 const name=(arabic?profile?.nameAr:profile?.nameEn)||profile?.name||'Business';
 const title=(arabic?profile?.metaTitleAr:profile?.metaTitleEn)||name;
 const description=(arabic?profile?.metaDescriptionAr:profile?.metaDescriptionEn)||'';
 const icon=publicAsset(profile?.faviconUrl)||publicAsset(profile?.logoUrl);
 let html=source.replace(/<title>[\s\S]*?<\/title>/i,`<title>${escapeHtml(title)}</title>`);
 html=setMeta(html,'name','description',description);
 html=setMeta(html,'property','og:title',title);
 html=setMeta(html,'property','og:description',description);
 html=setMeta(html,'property','og:site_name',name);
 html=setMeta(html,'property','og:url',`https://${hostname}${pathname}`);
 html=setMeta(html,'name','twitter:title',title);
 html=setMeta(html,'name','twitter:description',description);
 const canonical=`<link rel="canonical" href="${escapeHtml(`https://${hostname}${pathname}`)}"/>`;
 const canonicalPattern=/<link\s+rel="canonical"[^>]*>/i;
 html=canonicalPattern.test(html)?html.replace(canonicalPattern,canonical):html.replace(/<\/head>/i,`${canonical}</head>`);
 if(icon){const iconTag=`<link rel="icon" href="${escapeHtml(icon)}"/>`,iconPattern=/<link\s+rel="icon"[^>]*>/i;html=iconPattern.test(html)?html.replace(iconPattern,iconTag):html.replace(/<\/head>/i,`${iconTag}</head>`);}
 return html;
}
function createTenantBusinessProfileShell({pool,publicDir=path.resolve(process.cwd(),'client/public')}={}){
 const shellPath=path.join(publicDir,'index.html');let shellPromise;
 return async function tenantBusinessProfileShell(req,res,next){
  if(!req.crmTenantDomain||req.method!=='GET'||!['/user','/user/','/user/login','/agent','/agent/','/agent/login'].includes(req.path||''))return next();
  if(!req.accepts?.('html'))return next();
  let db;
  try{
   db=await pool.getConnection();const brand=await businessProfile.publicBrand(db,req.crmTenantDomain.hostname);db.release();db=null;if(!brand)return next();
   shellPromise??=fs.readFile(shellPath,'utf8');const shell=await shellPromise;
   const language=String(req.get('accept-language')||'').split(',')[0];const html=renderShell(shell,brand,{hostname:req.crmTenantDomain.hostname,pathname:req.path,arabic:/^ar(?:[-_]|$)/i.test(language)});
   res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Host, Accept-Language');return res.status(200).type('html').send(html);
  }catch(_error){if(db)db.release();return next();}
 };
}
module.exports={createTenantBusinessProfileShell,renderShell,publicAsset};
