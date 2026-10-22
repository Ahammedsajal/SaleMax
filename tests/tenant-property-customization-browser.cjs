'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const read=name=>fs.readFileSync(path.join(__dirname,'../client/public',name),'utf8');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;
  try{
    for(const language of ['en','ar'])for(const available of [true,false]){
      const page=await browser.newPage({viewport:{width:available?390:1280,height:900}});
      const oldPropertyField={key:'pf_text_0123456789abcdef',type:'text',label:{en:'Reserved spaces',ar:'المساحات المحجوزة'},required:false,active:true,version:1};
      const propertyScope={key:'property',documentKey:'propertyFields',prefix:'pf',label:{en:'Custom property fields',ar:'حقول العقارات المخصصة'},help:{en:'Add listing details.',ar:'أضف تفاصيل الإعلان.'},addLabel:{en:'Add property field',ar:'إضافة حقل عقار'},requiredLabel:{en:'Required for listings',ar:'مطلوب للإعلانات'},planAvailable:available,editable:available};
      const state={revision:available?0:1,active:available?null:{id:'active-schema7',revision:1,document:{schemaVersion:7,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{},propertyFields:[oldPropertyField],disabledModules:[]}},draft:null,defaults:{schemaVersion:8,navigationLabels:{},customFieldScopes:{lead:[],property:[]},hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{},disabledModules:[]},fields:[{key:'properties',label:{en:'Properties',ar:'العقارات'}}],customFieldScopes:[propertyScope],moduleOptions:available?[{key:'realestate.listings',label:{en:'Properties',ar:'العقارات'},requires:[]}]:[],taskTypes:[],taskTypeLabelOptions:[],propertyFieldsAvailable:available,history:[]};
      await page.setContent(`<html lang="${language}"><body><main id="host"><div class="wrap"></div></main></body></html>`);
      await page.evaluate(state=>{
        const requests=[];window.fixture={requests};
        let sequence=0;window.crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
        window.SaleMaxWorkspace={request:async(module,path='',options={method:'GET'})=>{requests.push({module,path,method:options.method,body:options.body});if(module!=='customization')throw Error('unexpected module');if(options.method==='GET')return {data:state};if(path==='/preview')return {data:{document:options.body.document,readOnly:true}};if(path==='/draft'){state.revision++;state.draft={id:'synthetic-draft',document:options.body.document};return {data:state.draft};}throw Error('unexpected customization action');},invalidateSession(){}};
      },state);
      await page.addScriptTag({content:read('lead-field-editor.js')});await page.addScriptTag({content:read('tenant-customization.js')});
      await page.evaluate(()=>window.SaleMaxCustomization.mount(document.querySelector('#host')));
      const panel=page.locator('[data-sx-customization]');await panel.locator('form').waitFor();
      if(!available){assert.equal(await panel.locator('[data-property-field-editor]').count(),0);assert.equal(await panel.locator('[data-add-property-field]').count(),0);await panel.locator('form details').first().locator('summary').click();await panel.locator('[data-label-key="properties"] [data-en]').fill('Property notes');await panel.locator('[data-label-key="properties"] [data-ar]').fill('ملاحظات العقار');await panel.locator('button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[data-publish]').disabled);const requests=await page.evaluate(()=>window.fixture.requests),draft=requests.find(request=>request.path==='/draft').body.document;assert.equal(draft.schemaVersion,8);assert.deepEqual(draft.customFieldScopes.property,[oldPropertyField],'plan-unavailable fields survive unrelated customization edits');await page.close();cases++;continue;}
      const editor=panel.locator('[data-property-field-editor]');await editor.locator('summary').click();await editor.locator('select').selectOption('text');await editor.locator('[data-add-property-field]').click();if(await editor.locator('[data-field-language=en]').count()!==1)throw Error(`Property customizer field not created: ${await editor.innerText()}`);
      await editor.locator('[data-field-language=en]').fill('Parking spaces');await editor.locator('[data-field-language=ar]').fill('مواقف السيارات');
      await panel.locator('[data-preview]').click();await panel.locator('[data-preview-result] li').waitFor();assert.match(await panel.locator('[data-preview-result]').innerText(),/Parking spaces/);
      await panel.locator('button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[data-publish]').disabled);
      let requests=await page.evaluate(()=>window.fixture.requests);const draft=requests.find(request=>request.path==='/draft').body.document;assert.equal(draft.schemaVersion,8);assert.equal(draft.customFieldScopes.property.length,1);assert.match(draft.customFieldScopes.property[0].key,/^pf_text_/);assert.equal(draft.customFieldScopes.property[0].label.ar,'مواقف السيارات');assert.deepEqual(draft.disabledModules,[]);assert.deepEqual(draft.customFieldScopes.lead,[]);
      await panel.locator('[data-defaults]').click();await panel.locator('button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[data-publish]').disabled);
      requests=await page.evaluate(()=>window.fixture.requests);const reset=requests.filter(request=>request.path==='/draft').at(-1).body.document;assert.equal(reset.customFieldScopes.property[0].active,false);assert.deepEqual(reset.customFieldScopes.lead,[]);
      await page.close();cases++;
    }
    console.log(JSON.stringify({passed:true,cases,checks:['plan-unavailable fields are read-only and preserved','tenant draft schema v8','registered property scope and prefix','English Arabic labels','preview and draft persistence','reset archives property fields','category-unavailable accounts cannot configure property fields']}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
