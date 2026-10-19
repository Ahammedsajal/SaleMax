'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../client/public/training-courses.js'),'utf8');
test('catalogue navigation uses category permission even when the catalogue API is unavailable',async()=>{
 for(const [category,granted]of [['salemax_sales',true],['training_center',true],['salemax_sales',false]]){
  const inserted=[],labels={};let catalogueRequests=0,click;
  const primary={textContent:'Team Login'},button={setAttribute:(k,v)=>labels[k]=v,set onclick(v){click=v;}};
  const copy={dataset:{sxSearchHidden:'1'},style:{removeProperty:()=>{}},removeAttribute:()=>{},querySelectorAll:()=>[],querySelector:s=>s==='.MuiListItemText-primary'?primary:button,setAttribute:(k,v)=>labels['row-'+k]=v};
  const parent={querySelector:()=>inserted[0]||null,insertBefore:node=>inserted.push(node)};
  const row={parentElement:parent,cloneNode:()=>copy};
  const anchor={textContent:'Team Login',innerText:'',closest:s=>s==='li'?row:null};
  const context={window:{SaleMaxWorkspace:{session:async()=>({categoryKey:category,modules:{products:category==='salemax_sales'&&granted,courses:category==='training_center'&&granted}})}},document:{querySelector:()=>null,querySelectorAll:()=>[anchor]},location:{pathname:'/user',href:''},getToken:()=> 'synthetic',tr:()=>category==='salemax_sales'?'Products & services':'Courses',api:async()=>{catalogueRequests++;throw Error('UNAVAILABLE');}};
  vm.createContext(context);
  const functions=source.slice(source.indexOf('  async function checkCourseAccess()'),source.indexOf('\n  let renderedLanguage'));
  vm.runInContext("let products=false,rootPath='',navToken='',navAllowed=false,navChecked=false,navLoading=false;"+functions,context);
  await vm.runInContext('checkCourseAccess()',context);
  assert.equal(catalogueRequests,0);assert.equal(inserted.length,granted?1:0);
  if(granted){assert.equal(copy.hidden,false);assert.deepEqual(Object.keys(copy.dataset),['sxCourseNav','sxCatalogKind']);assert.equal(primary.textContent,category==='salemax_sales'?'Products & services':'Courses');click({preventDefault(){}});assert.equal(context.location.href,'/user?page='+(category==='salemax_sales'?'products-services':'courses'));}
 }
});
