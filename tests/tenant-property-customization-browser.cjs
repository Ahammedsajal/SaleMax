'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const read=name=>fs.readFileSync(path.join(__dirname,'../client/public',name),'utf8');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;
  try{
    for(const language of ['en','ar'])for(const available of [true,false]){
      const page=await browser.newPage({viewport:{width:available?390:1280,height:900}});
      const state={revision:0,active:null,draft:null,defaults:{schemaVersion:7,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{},propertyFields:[],disabledModules:[]},fields:[{key:'properties',label:{en:'Properties',ar:'العقارات'}}],moduleOptions:available?[{key:'realestate.listings',label:{en:'Properties',ar:'العقارات'},requires:[]}]:[],taskTypes:[],taskTypeLabelOptions:[],propertyFieldsAvailable:available,history:[]};
      await page.setContent(`<html lang="${language}"><body><main id="host"><div class="wrap"></div></main></body></html>`);
      await page.evaluate(state=>{
        const requests=[];window.fixture={requests};
        let sequence=0;window.crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
        window.SaleMaxWorkspace={request:async(module,path='',options={method:'GET'})=>{requests.push({module,path,method:options.method,body:options.body});if(module!=='customization')throw Error('unexpected module');if(options.method==='GET')return {data:state};if(path==='/preview')return {data:{document:options.body.document,readOnly:true}};if(path==='/draft'){state.revision++;state.draft={id:'synthetic-draft',document:options.body.document};return {data:state.draft};}throw Error('unexpected customization action');},invalidateSession(){}};
      },state);
      await page.addScriptTag({content:read('lead-field-editor.js')});await page.addScriptTag({content:read('tenant-customization.js')});
      await page.evaluate(()=>window.SaleMaxCustomization.mount(document.querySelector('#host')));
      const panel=page.locator('[data-sx-customization]');await panel.locator('form').waitFor();
      if(!available){assert.equal(await panel.locator('[data-property-field-editor]').count(),0);assert.equal(await panel.locator('[data-add-property-field]').count(),0);await page.close();cases++;continue;}
      const editor=panel.locator('[data-property-field-editor]');await editor.locator('summary').click();await editor.locator('select').selectOption('text');await editor.locator('[data-add-property-field]').click();if(await editor.locator('[data-field-language=en]').count()!==1)throw Error(`Property customizer field not created: ${await editor.innerText()}`);
      await editor.locator('[data-field-language=en]').fill('Parking spaces');await editor.locator('[data-field-language=ar]').fill('مواقف السيارات');
      await panel.locator('[data-preview]').click();await panel.locator('[data-preview-result] li').waitFor();assert.match(await panel.locator('[data-preview-result]').innerText(),/Parking spaces/);
      await panel.locator('button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[data-publish]').disabled);
      let requests=await page.evaluate(()=>window.fixture.requests);const draft=requests.find(request=>request.path==='/draft').body.document;assert.equal(draft.schemaVersion,7);assert.equal(draft.propertyFields.length,1);assert.match(draft.propertyFields[0].key,/^pf_text_/);assert.equal(draft.propertyFields[0].label.ar,'مواقف السيارات');assert.deepEqual(draft.disabledModules,[]);assert.deepEqual(draft.leadFields,[]);
      await panel.locator('[data-defaults]').click();await panel.locator('button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[data-publish]').disabled);
      requests=await page.evaluate(()=>window.fixture.requests);const reset=requests.filter(request=>request.path==='/draft').at(-1).body.document;assert.equal(reset.propertyFields[0].active,false);assert.equal(reset.leadFields.length,0);
      await page.close();cases++;
    }
    console.log(JSON.stringify({passed:true,cases,checks:['published property-field capability gate','tenant draft schema v7','property IDs do not collide with lead fields','English Arabic labels','preview and draft persistence','reset archives property fields','category-unavailable accounts cannot configure property fields']}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
