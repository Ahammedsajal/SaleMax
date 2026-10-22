'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const spec=require('../docs/WORKSPACE_FORMS_OPENAPI.json');

const expected={
  '/context':['get'],'/':['get','post'],'/lead-fields':['get'],'/submissions':['get'],
  '/{id}':['put'],'/{id}/publish':['post'],'/staff/{formSlug}':['get'],
  '/staff/{formSlug}/leads':['get'],'/staff/{formSlug}/submissions':['post'],
  '/registration':['post'],'/{tenantSlug}/{formSlug}':['get'],
  '/{tenantSlug}/{formSlug}/submissions':['post']
};

test('Forms OpenAPI operations map to the shared authenticated and public routers',()=>{
  assert.equal(spec.openapi,'3.1.0');
  const mounts=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/training-form-router.js'),'utf8');
  assert.match(mounts,/app\.use\(\['\/api\/workspace\/forms','\/api\/user\/training\/forms'\],createTrainingFormRouter/);
  assert.match(mounts,/app\.use\('\/api\/public\/training\/forms',createPublicTrainingFormRouter/);
  assert.deepEqual(Object.fromEntries(Object.entries(spec.paths).map(([route,ops])=>[route,Object.keys(ops).sort()])),Object.fromEntries(Object.entries(expected).map(([route,methods])=>[route,methods.sort()])));
  for(const [route,methods] of Object.entries(expected)){
    const local=route.replace(/\{([^}]+)\}/g,':$1');
    for(const method of methods)assert.ok(router.includes(`router.${method}('${local}'`),`${method.toUpperCase()} ${route} must exist in the shared router`);
  }
  assert.deepEqual(spec.servers.map(server=>server.url),['/api/workspace/forms','/api/user/training/forms']);
  assert.deepEqual(spec.paths['/{tenantSlug}/{formSlug}'].get.servers.map(server=>server.url),['/api/public/training/forms']);
});

test('Forms contract keeps tenant, category, entitlement, role and record scope server-derived',()=>{
  assert.match(spec.info.description,/does not enable Forms for any category/);
  assert.match(spec.info.description,/portal\.forms and crm\.leads/);
  assert.match(spec.paths['/'].post.description,/transactionally/);
  assert.match(spec.paths['/staff/{formSlug}/leads'].get.description,/Agents are additionally restricted to assigned leads/);
  assert.match(spec.paths['/staff/{formSlug}/submissions'].post.description,/Cross-tenant and unassigned Agent lead IDs are rejected/);
  for(const name of ['FormDraft','FormUpdateRequest','RevisionRequest','StaffSubmissionRequest','PublicSubmissionRequest'])
    assert.equal(Object.hasOwn(spec.components.schemas[name].properties||{},'tenantId'),false,`${name} cannot choose a tenant`);
  assert.equal(spec.components.schemas.StaffSubmissionRequest.required.includes('expectedFormVersion'),true);
  assert.equal(spec.components.schemas.PublicSubmissionRequest.required.includes('expectedFormVersion'),true);
});

test('Forms OpenAPI references resolve and operation IDs are unique',()=>{
  const ids=[];
  function visit(value){
    if(Array.isArray(value)){for(const item of value)visit(item);return;}
    if(!value||typeof value!=='object')return;
    if(typeof value.$ref==='string'){
      assert.ok(value.$ref.startsWith('#/'),`unsupported external reference ${value.$ref}`);
      let target=spec;for(const segment of value.$ref.slice(2).split('/'))target=target?.[segment.replace(/~1/g,'/').replace(/~0/g,'~')];
      assert.notEqual(target,undefined,`unresolved reference ${value.$ref}`);
    }
    if(typeof value.operationId==='string')ids.push(value.operationId);
    for(const child of Object.values(value))visit(child);
  }
  visit(spec);
  assert.equal(new Set(ids).size,ids.length);
});
