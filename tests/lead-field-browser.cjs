'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;try{
 for(const lang of ['en','ar'])for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${lang}"><body><section id="editor"><form><div class="actions"></div></form></section><form id="lead"><button type="submit">Save</button></form></body></html>`}));await page.goto('http://127.0.0.1/user');
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../client/public/lead-field-editor.js'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../client/public/pipeline/lead-fields.js'),'utf8')});
  // Seed secure context crypto for the local-only fixture's generated IDs.
  await page.evaluate(()=>{let n=0;window.crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;window.SaleMaxLeadFieldEditor.mount(document.querySelector('#editor'),[],{scope:'lead'});window.SaleMaxLeadFieldEditor.mount(document.querySelector('#editor'),[],{scope:'property'});});
  await page.locator('#editor [data-lead-field-editor] summary').click();
  for(const type of ['text','integer','boolean','date']){
   await page.locator('#editor [data-lead-field-editor] select').selectOption(type);await page.locator('[data-add-lead-field]').click();const row=page.locator('#editor [data-lead-field-editor] fieldset').last();await row.locator('[data-field-language=en]').fill(type+' field');await row.locator('[data-field-language=ar]').fill('حقل '+type);
  }
  const defs=await page.evaluate(()=>window.SaleMaxLeadFieldEditor.collect(document.querySelector('#editor')));assert.equal(new Set(defs.map(x=>x.key)).size,4);
  const propertyEditor=page.locator('#editor [data-property-field-editor]');await propertyEditor.locator('summary').click();await propertyEditor.locator('select').selectOption('text');await propertyEditor.locator('[data-add-property-field]').click();await propertyEditor.locator('[data-field-language=en]').fill('Parking spaces');await propertyEditor.locator('[data-field-language=ar]').fill('مواقف السيارات');
  const propertyDefs=await page.evaluate(()=>window.SaleMaxLeadFieldEditor.collect(document.querySelector('#editor'),'property'));assert.equal(propertyDefs.length,1);assert.match(propertyDefs[0].key,/^pf_text_/);assert.equal((await page.evaluate(()=>window.SaleMaxLeadFieldEditor.collect(document.querySelector('#editor'),'lead'))).length,4);
  await page.evaluate(()=>window.SaleMaxLeadFieldEditor.reset(document.querySelector('#editor'),'property'));assert.equal((await page.evaluate(()=>window.SaleMaxLeadFieldEditor.collect(document.querySelector('#editor'),'property')))[0].active,false);assert.equal((await page.evaluate(()=>window.SaleMaxLeadFieldEditor.collect(document.querySelector('#editor'),'lead'))).filter(field=>field.active).length,4);
  await page.evaluate(defs=>{window.contract={revision:5,fields:defs};window.SaleMaxLeadFields.mount(document.querySelector('#lead'),window.contract,{});},defs);
  await page.locator('#lead input[type=text]').fill('Business A');await page.locator('#lead input[type=number]').fill('0');await page.locator('#lead select').selectOption('false');await page.locator('#lead input[type=date]').fill('2026-10-20');
  const result=await page.evaluate(()=>window.SaleMaxLeadFields.collect(document.querySelector('#lead')));assert.equal(result.configurationRevision,5);assert.deepEqual(Object.values(result.values),['Business A',0,false,'2026-10-20']);
  const saved=Object.fromEntries(defs.map((d,i)=>[d.key,{value:Object.values(result.values)[i],definition:d,configurationRevision:5}]));
  await page.evaluate(({defs,saved})=>{window.SaleMaxLeadFields.mount(document.querySelector('#lead'),{revision:6,fields:defs.map(d=>({...d,active:false}))},saved);},{defs,saved});
  assert.equal(await page.locator('#lead input,#lead select').count(),0);assert.match(await page.locator('#lead details').textContent(),/Business A/);assert.deepEqual((await page.evaluate(()=>window.SaleMaxLeadFields.collect(document.querySelector('#lead')))).values,{});
  await page.close();cases++;
 }
 console.log(JSON.stringify({passed:true,cases,checks:['separate lead and property field editors','bilingual field builder','desktop mobile','four typed values','zero and false preserved','property reset leaves lead fields unchanged','archive read-only snapshots']}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
