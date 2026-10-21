'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {baseCrm,trainingCenter,salemaxSales,getCategory}=require('../modules/platform/categories');
const {decision}=require('../modules/platform/policy'),{definition}=require('../modules/platform/plans');
test('base CRM explicitly shares core capabilities without either vertical or implicit catalogue',()=>{
 assert.equal(baseCrm.planable,true);assert.equal(baseCrm.public,false);assert.equal(baseCrm.catalogue,null);assert.equal(getCategory('base_crm',2),null);
 const ctx={audience:'tenant',tenant:{id:'base-a',status:'active',categoryKey:'base_crm',categoryVersion:1},category:baseCrm,membership:{tenantId:'base-a',role:'owner',status:'active'},subscription:{status:'active',categoryKey:'base_crm',categoryVersion:1,capabilities:baseCrm.capabilities}};
 for(const capability of ['messaging.inbox','messaging.qr','automation.flows','automation.chatbot','crm.leads','crm.contacts','team.tasks','tenant.settings'])assert.equal(decision(ctx,{capability,permission:require('../modules/platform/policy').capabilities[capability][0]}).allowed,true);
 for(const capability of ['training.courses','portal.forms','products.catalog','sales.deals','sales.finance','hr.recruitment','finance.invoices'])assert.equal(decision(ctx,{capability,permission:require('../modules/platform/policy').capabilities[capability][0]}).allowed,false);
 assert.equal(require('../modules/platform/product-catalog').kind(ctx),null);
 assert.throws(()=>definition({categoryKey:'base_crm',categoryVersion:1,capabilities:['products.catalog'],roleLimits:{owner:1,accountant:0,manager:1,agent:2}}));
 assert.equal(trainingCenter.catalogue,'courses');assert.equal(salemaxSales.catalogue,'products');
});
