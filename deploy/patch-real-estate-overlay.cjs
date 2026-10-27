'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(process.argv[2]||'/app');
function apply(relative,before,after){
  const file=path.join(root,relative),source=fs.readFileSync(file,'utf8');
  if(source.includes(after))return;
  const first=source.indexOf(before);
  if(first<0||source.indexOf(before,first+before.length)>=0)throw Error(`REAL_ESTATE_PATCH_ANCHOR:${relative}`);
  fs.writeFileSync(file,source.slice(0,first)+after+source.slice(first+before.length));
}

apply('modules/platform/categories.js',
  "const baseCrm = Object.freeze({ key:'base_crm'",
  "const realEstate = Object.freeze({ key:'real_estate',version:1,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:true,seatRoles:Object.freeze(['owner','manager','team_leader','agent']),capabilities:Object.freeze([...sharedCapabilities,'realestate.listings']),migration:'20261222_real_estate_properties.sql' });\nconst baseCrm = Object.freeze({ key:'base_crm'");
apply('modules/platform/categories.js',
  'createCategoryRegistry([trainingCenter, sevenNetworkSales, baseCrm, restaurantFixture]',
  'createCategoryRegistry([trainingCenter, sevenNetworkSales, realEstate, baseCrm, restaurantFixture]');
apply('modules/platform/categories.js',
  "sevenNetworkSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), salemaxSales:",
  "sevenNetworkSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), realEstate:registry.get(realEstate.key,realEstate.version), salemaxSales:");

apply('modules/platform/feature-contract.js',
  "products:['products.catalog','products.read'],courses:",
  "products:['products.catalog','products.read'],properties:['realestate.listings','properties.read'],courses:");
apply('modules/platform/policy.js',
  "  'properties.read': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },",
  "  'properties.read': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },\n  // Shared partner inventory needs a separate office-level read grant.\n  'properties.shared.read': { owner: 'tenant', manager: 'tenant' },");
apply('modules/platform/policy.js',
  "  'realestate.listings': ['properties.read','properties.manage','properties.assign'],",
  "  'realestate.listings': ['properties.read','properties.shared.read','properties.manage','properties.assign'],");
apply('modules/platform/policy.js',
  "if (permission.startsWith('properties.') && !['owner','manager'].includes(membership.role) && permission!=='properties.read') return null;",
  "if (permission.startsWith('properties.') && !['owner','manager'].includes(membership.role) && !['properties.read','properties.shared.read'].includes(permission)) return null;");
apply('client/public/team-invitations.js',
  'const permissionModules={products:',
  "const permissionModules={properties:['Properties','العقارات'],products:");
apply('modules/platform/navigation.js',
  "  ['products-services', 'products.catalog', 'products.read', 'Products & services'",
  "  ['properties', 'realestate.listings', 'properties.read', 'Properties', 'العقارات', 'Real Estate', 'العقارات'],\n  ['products-services', 'products.catalog', 'products.read', 'Products & services'");

apply('modules/platform/mount-existing-upgrade.js',
  "  app.use('/api/workspace/products-services',createTrainingCourseRouter({pool,origin,userGuard,canonicalGuard:businessBoundary.guard,sessionGuard:featureSession.guard,products:true}));",
  "  app.use('/api/workspace/products-services',createTrainingCourseRouter({pool,origin,userGuard,canonicalGuard:businessBoundary.guard,sessionGuard:featureSession.guard,products:true}));\n  app.use('/api/workspace/properties',require('./real-estate-properties-router').createRouter({pool,authenticate:featureSession.guard}));\n  app.get('/property-listings/',(req,res)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',\"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'\");res.sendFile(require('node:path').resolve(__dirname,'../../client/public/property-listings/index.html'));});");

apply('client/public/training-sidebar.js',
  "button.setAttribute('aria-label',tr('Properties','العقارات'));button.onclick=event=>{event.preventDefault();location.href='/user?page=properties';};list.append(copy);",
  "button.setAttribute('aria-label',tr('Properties','العقارات'));button.onclick=event=>{event.preventDefault();location.href='/user?page=properties&section=units';};list.append(copy);\n      for(const [section,en,arabic] of [['units','Buildings & Units','المباني والوحدات'],['listings','Listings','الإعلانات']]){\n        const child=cloneNavigationRow(pipelineSource);child.removeAttribute('data-salemax-pipeline-link');child.dataset.sxPropertiesChild=section;child.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));\n        const label=child.querySelector('.MuiListItemText-primary');if(label)label.textContent=tr(en,arabic);\n        const target=child.querySelector('.MuiListItemButton-root,[role=button],button,a')||child;target.style.paddingInlineStart='32px';target.setAttribute('aria-label',tr(en,arabic));\n        target.onclick=event=>{event.preventDefault();location.href='/user?page=properties&section='+section;};list.append(child);\n      }");

apply('client/public/pipeline-entry.js',
  "frame.src='/property-listings/?embed=1';",
  "const params=new URLSearchParams(location.search),section=params.get('section')==='units'?'units':'listings',unitId=params.get('unitId');frame.src='/property-listings/?embed=1&section='+section+(unitId?'&unitId='+encodeURIComponent(unitId):'');");

for(const relative of ['modules/platform/categories.js','modules/platform/feature-contract.js','modules/platform/navigation.js','modules/platform/policy.js','modules/platform/mount-existing-upgrade.js','client/public/training-sidebar.js','client/public/team-invitations.js','client/public/pipeline-entry.js']){
  require('node:child_process').execFileSync(process.execPath,['--check',path.join(root,relative)]);
}
console.log('real-estate overlay patches applied');
