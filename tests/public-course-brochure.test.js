'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const domains=require('../modules/platform/tenant-crm-domains');
const forms=require('../modules/platform/training-forms');
const catalogue=require('../modules/platform/tenant-storefront-catalogue');
const branches=require('../modules/platform/tenant-storefront-branches');
const media=require('../modules/platform/training-course-media');
const website=require('../modules/web/public-website');
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const courseId='11111111-1111-4111-8111-111111111111';
const mediaId='22222222-2222-4222-8222-222222222222';
function fixtures(t,{showCourseCatalog=true}={}){
  const originals={brand:domains.publicBrand,form:forms.publicForm,courses:catalogue.trainingCourses,branches:branches.publicBranches,file:media.getFile};
  domains.publicBrand=async()=>({name:'Center',slug:'center',categoryKey:'training_center',categoryVersion:1,tenantId,revision:2,primaryHostname:'courses.example.qa',content:{showCourseCatalog,publicFormSlug:'course-enquiry'},whatsappNumber:''});
  forms.publicForm=async()=>({form:{slug:'course-enquiry'}});
  catalogue.trainingCourses=async()=>showCourseCatalog?[{publicId:courseId,nameEn:'First Aid',nameAr:'الإسعافات الأولية',brochureMediaId:mediaId,brochureUrl:`/courses/${courseId}/brochure`}]:[];
  branches.publicBranches=async()=>[];
  media.getFile=async(_db,tenant,course,file)=>{assert.equal(tenant,tenantId);assert.equal(course,courseId);assert.equal(file,mediaId);return {kind:'document',mimeType:'application/pdf',originalName:'intro.pdf',sizeBytes:123,path:'/private/course-media/intro.pdf'};};
  t.after(()=>{domains.publicBrand=originals.brand;forms.publicForm=originals.form;catalogue.trainingCourses=originals.courses;branches.publicBranches=originals.branches;media.getFile=originals.file;});
}
function request(path,language=''){return {path,originalUrl:path,crmTenantDomain:{hostname:'courses.example.qa'},get:name=>name.toLowerCase()==='accept-language'?language:''};}
function response(){const headers={};return {headers,statusCode:200,setHeader(key,value){headers[key]=value;},set(){return this;},status(code){this.statusCode=code;return this;},type(){return this;},send(body){this.body=body;return body;},sendFile(file,options,callback){this.file=file;this.fileOptions=options;this.callback=callback;return file;},headers};}

test('public brochure download requires storefront catalogue publication and returns an attachment',async t=>{
  fixtures(t);const pool={async getConnection(){return {release(){}};}};const res=response();
  await website.sendTenantStorefront(request(`/courses/${courseId}/brochure`),res,pool);
  assert.equal(res.file,'/private/course-media/intro.pdf');assert.equal(res.headers['Content-Type'],'application/pdf');assert.match(res.headers['Content-Disposition'],/attachment/);assert.equal(res.headers['X-Content-Type-Options'],'nosniff');assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.fileOptions.acceptRanges,false);
});

test('unselected brochure is absent from the public catalogue output',async t=>{
  fixtures(t);catalogue.trainingCourses=async()=>[{publicId:courseId,nameEn:'First Aid',nameAr:'الإسعافات الأولية',brochureMediaId:null,brochureUrl:null}];
  const pool={async getConnection(){return {release(){}};}};const res=response();
  await website.sendTenantStorefront(request('/'),res,pool);
  assert.equal(res.statusCode,200);assert.doesNotMatch(res.body,/Download course brochure|تنزيل كتيب الدورة/);
});

test('brochure cannot be fetched while the business storefront has not published its course catalogue',async t=>{
  fixtures(t,{showCourseCatalog:false});const pool={async getConnection(){return {release(){}};}};const res=response();
  await website.sendTenantStorefront(request(`/courses/${courseId}/brochure`),res,pool);
  assert.equal(res.statusCode,404);assert.equal(res.body,'This brochure is not available.');
});

test('published service and product sections render bilingual item cards with escaped content',async t=>{
  fixtures(t,{showCourseCatalog:false});
  domains.publicBrand=async()=>({name:'Center',slug:'center',categoryKey:'training_center',categoryVersion:1,tenantId,revision:2,primaryHostname:'courses.example.qa',content:{sections:[{type:'services',title:'Services',titleAr:'الخدمات',items:[{title:'Home cleaning',titleAr:'تنظيف المنزل',body:'Deep clean <script>bad()</script>',bodyAr:'تنظيف شامل'}]},{type:'products',title:'Products',titleAr:'المنتجات',items:[{title:'Care kit',titleAr:'مجموعة العناية',body:'Daily essentials',bodyAr:'مستلزمات يومية'}]}]},whatsappNumber:''});
  const pool={async getConnection(){return {release(){}};}};const english=response();await website.sendTenantStorefront(request('/'),english,pool);
  assert.match(english.body,/Home cleaning/);assert.match(english.body,/Deep clean &lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.match(english.body,/Care kit/);
  const arabic=response();await website.sendTenantStorefront(request('/','ar'),arabic,pool);assert.match(arabic.body,/تنظيف المنزل/);assert.match(arabic.body,/مستلزمات يومية/);assert.match(arabic.body,/dir="rtl"/);
});
