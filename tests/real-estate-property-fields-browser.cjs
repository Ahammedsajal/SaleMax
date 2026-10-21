'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fields=[
  {key:'pf_text_0123456789abcdef',type:'text',label:{en:'View',ar:'الإطلالة'},required:true,active:true,version:1},
  {key:'pf_integer_0123456789abcdee',type:'integer',label:{en:'Parking spaces',ar:'مواقف السيارات'},required:true,active:true,version:1},
  {key:'pf_boolean_0123456789abcdef',type:'boolean',label:{en:'Pets allowed',ar:'السماح بالحيوانات'},required:true,active:true,version:1},
  {key:'pf_date_0123456789abcdef',type:'date',label:{en:'Available from',ar:'متاح ابتداءً من'},required:false,active:true,version:1},
];
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;
  try{
    for(const language of ['en','ar'])for(const width of [390,1280]){
      const page=await browser.newPage({viewport:{width,height:900}}),pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
      await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><body><main id="properties-app"></main></body></html>`}));
      await page.goto('http://127.0.0.1/properties');
      await page.evaluate(language=>localStorage.setItem('language',language),language);
      await page.evaluate(({fields})=>{
        const listings=[],requests=[];
        let revision=1;
        window.SaleMaxWorkspace={
          session:async()=>({categoryKey:'real_estate',categoryVersion:1,modules:{properties:true},permissions:{'properties.manage':true,'properties.assign':false},timezone:'Asia/Qatar'}),
          request:async(module,path,options={method:'GET'})=>{
            requests.push({module,path,options});
            if(module!=='properties')throw Error('unexpected module');
            if(options.method==='GET'&&path==='/assignees')return {success:true,data:{items:[]}};
            if(options.method==='GET')return {success:true,data:{items:listings,total:listings.length,page:1,limit:25,fieldContract:{revision:4,fields}}};
            if(options.method==='POST'){
              const body=options.body,item={id:'property-a',referenceCode:'RE-SYNTHETIC',...body,revision:++revision,assignedName:null,customFields:Object.fromEntries(Object.entries(body.customFields.values).map(([key,value])=>[key,{value,definition:fields.find(field=>field.key===key),configurationRevision:4}]))};
              listings.splice(0,listings.length,item);return {success:true,data:item};
            }
            if(options.method==='PUT'){
              const body=options.body,item=listings[0];Object.assign(item,body,{revision:++revision,customFields:Object.fromEntries(Object.entries(body.customFields.values).map(([key,value])=>[key,{value,definition:fields.find(field=>field.key===key),configurationRevision:4}]))});return {success:true,data:item};
            }
            throw Error('unexpected request');
          }
        };
        window.fixture={requests,listings};
      },{fields});
      await page.addScriptTag({path:path.join(__dirname,'../client/public/property-listings/properties.js')});
      await page.waitForTimeout(150);if(!await page.locator('#new-property').count())throw Error(`Properties screen did not load: ${await page.locator('#properties-app').innerText()} ${pageErrors.join('; ')}`);await page.locator('#new-property').click();
      const form=page.locator('#property-form');
      await form.locator('[name=titleEn]').fill('Synthetic apartment');await form.locator('[name=titleAr]').fill('شقة اختبارية');
      await form.locator('[name=price]').fill('1250');await form.locator('[name=city]').fill('Synthetic Doha');
      await form.locator('[name=descriptionEn]').fill('Synthetic description');await form.locator('[name=descriptionAr]').fill('وصف اختباري');
      await form.locator(`[data-property-field="${fields[0].key}"]`).fill('North facing');
      await form.locator(`[data-property-field="${fields[1].key}"]`).fill('0');
      await form.locator(`[data-property-field="${fields[2].key}"]`).selectOption('false');
      await form.locator(`[data-property-field="${fields[3].key}"]`).fill('2026-11-02');
      await form.locator('button[type=submit]').click();await page.waitForTimeout(150);if(!await page.locator('[data-edit-id="property-a"]').count())throw Error(`Saved listing did not render: ${await page.locator('#properties-app').innerText()} ${JSON.stringify(await page.evaluate(()=>window.fixture.requests.map(r=>({path:r.path,method:r.options.method}))))} ${pageErrors.join('; ')}`);
      let saved=await page.evaluate(()=>window.fixture.requests.find(request=>request.options.method==='POST').options.body);
      assert.equal(saved.customFields.configurationRevision,4);
      assert.deepEqual(saved.customFields.values,{[fields[0].key]:'North facing',[fields[1].key]:0,[fields[2].key]:false,[fields[3].key]:'2026-11-02'});
      const rendered=await page.locator('#properties-app').innerText();assert.ok(rendered.includes(language==='ar'?'الإطلالة':'View'),rendered);
      await page.locator('[data-edit-id="property-a"]').click();
      const edit=page.locator('#property-form');assert.equal(await edit.locator(`[data-property-field="${fields[2].key}"]`).inputValue(),'false');
      await edit.locator(`[data-property-field="${fields[0].key}"]`).fill('Park view');await edit.locator('button[type=submit]').click();
      saved=await page.evaluate(()=>window.fixture.requests.find(request=>request.options.method==='PUT').options.body);
      assert.equal(saved.expectedRevision,2);assert.equal(saved.customFields.values[fields[0].key],'Park view');assert.equal(saved.customFields.values[fields[2].key],false);
      await page.close();cases++;
    }
    console.log(JSON.stringify({passed:true,cases,checks:['existing Properties screen','EN and AR','mobile and desktop','four typed custom fields','zero and false preserve exact values','required-field forms','custom labels render','create and revision-safe edit']}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
