'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const spec=require('../docs/WORKSPACE_CUSTOMIZATION_OPENAPI.json');

test('workspace customization OpenAPI paths match the mounted shared router',()=>{
  assert.equal(spec.openapi,'3.1.0');
  const mounts=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/tenant-customization-router.js'),'utf8');
  assert.match(mounts,/app\.use\(\['\/api\/workspace\/customization','\/api\/crm\/customization'\],customization\)/);
  assert.match(router,/router\.get\('\/'/);
  assert.match(router,/router\.post\('\/preview'/);
  assert.ok(router.includes("for(const action of ['draft','publish','rollback'])router[action==='draft'?'put':'post']('/'+action,"));
  const expected={'/customization':['get'],'/customization/preview':['post'],'/customization/draft':['put'],'/customization/publish':['post'],'/customization/rollback':['post']};
  assert.deepEqual(Object.fromEntries(Object.entries(spec.paths).map(([route,operations])=>[route,Object.keys(operations).sort()])),Object.fromEntries(Object.entries(expected).map(([route,methods])=>[route,methods.sort()])));
  assert.deepEqual(spec.servers.map(server=>server.url),['/api/workspace','/api/crm']);
});

test('customization contract requires revision checks and never accepts a client tenant selector',()=>{
  const schemas=spec.components.schemas;
  assert.ok(schemas.DraftRequest.required.includes('expectedRevision'));
  assert.ok(schemas.RevisionRequest.required.includes('expectedRevision'));
  assert.ok(schemas.RollbackRequest.required.includes('expectedRevision'));
  for(const schema of [schemas.PreviewRequest,schemas.DraftRequest,schemas.RevisionRequest,schemas.RollbackRequest])
    assert.equal(Object.hasOwn(schema.properties||{},'tenantId'),false);
  assert.match(spec.info.description,/verified server context/);
  assert.match(spec.paths['/customization/preview'].post.description,/performs no persistence/);
  assert.match(spec.paths['/customization/rollback'].post.description,/appends a new published revision/);
});

test('customization OpenAPI document has resolvable local references and unique operation IDs',()=>{
  const operationIds=[];
  function visit(value){
    if(Array.isArray(value)){for(const item of value)visit(item);return;}
    if(!value||typeof value!=='object')return;
    if(typeof value.$ref==='string'){
      assert.ok(value.$ref.startsWith('#/'),`unsupported external reference ${value.$ref}`);
      let target=spec;for(const segment of value.$ref.slice(2).split('/'))target=target?.[segment.replace(/~1/g,'/').replace(/~0/g,'~')];
      assert.notEqual(target,undefined,`unresolved reference ${value.$ref}`);
    }
    if(typeof value.operationId==='string')operationIds.push(value.operationId);
    for(const child of Object.values(value))visit(child);
  }
  visit(spec);
  assert.equal(new Set(operationIds).size,operationIds.length,'operationId values must be unique');
});
