'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Real Estate properties mount in the existing business shell through shared APIs',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  const script=fs.readFileSync(path.join(root,'client/public/property-listings/properties.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'client/public/workspace-api.js'),'utf8');
  const registry=fs.readFileSync(path.join(root,'modules/platform/navigation.js'),'utf8');
  assert.match(html,/<script defer src="\/property-listings\/properties\.js\?v=20261026-request-assignment1"><\/script>/);
  assert.match(script,/get\('page'\)==='properties'/);
  assert.match(script,/SaleMaxWorkspace\.request\('properties'/);
  assert.match(script,/SaleMaxWorkspace\.session\(\)/);
  assert.match(api,/properties:'\/api\/workspace\/properties'/);
  assert.match(registry,/\['properties',\s*'realestate\.listings',\s*'properties\.read'/);
  assert.match(script,/session\.categoryKey!=='real_estate'/);
});

test('Real Estate screen styles are isolated and responsive inside the user shell',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../client/public/real-estate-properties.css'),'utf8');
  assert.match(css,/#properties-app\{/);
  assert.match(css,/@media\(max-width:640px\)/);
  assert.doesNotMatch(css,/(^|})\s*(body|:root|\.card|\.button)\s*\{/);
});
