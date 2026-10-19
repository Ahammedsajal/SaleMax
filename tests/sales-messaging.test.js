'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {salemaxSales,trainingCenter}=require('../modules/platform/categories'),policy=require('../modules/platform/policy'),navigation=require('../modules/platform/navigation');
const {messaging}=require('../scripts/enable-sales-messaging.cjs');
function context(role='owner',capabilities=salemaxSales.capabilities){return {audience:'tenant',tenant:{id:'sales',status:'active',categoryKey:'salemax_sales',categoryVersion:1},membership:{id:'member',tenantId:'sales',status:'active',role},category:salemaxSales,subscription:{status:'active',capabilities}};}
test('Sales includes all existing messaging/automation features while keeping Training-specific records separate',()=>{
 const keys=navigation.navigationFor(context()).map(x=>x.key);
 for(const key of ['whatsapp-qr','whatsapp-meta','templates','campaigns','campaign-dashboard','flows','chatbot','faqs','products-services'])assert.ok(keys.includes(key),key);
 for(const key of ['courses','batches','students','training-profile'])assert.ok(!keys.includes(key),key);
 for(const capability of messaging)assert.ok(trainingCenter.capabilities.includes(capability));
 assert.equal(salemaxSales.public,false);
});
test('Sales messaging still requires an active plan grant and explicit staff authority',()=>{
 const permission={capability:'campaigns.send',permission:'campaigns.manage'};
 assert.equal(policy.decision(context('owner',[]),permission).allowed,false);
 assert.equal(policy.decision(context('agent'),permission).allowed,false);
 const assigned=context('agent');assigned.membership.customPermissions=['campaigns.manage'];assigned.membership.assignedNavigation=['campaigns'];assert.equal(policy.decision(assigned,permission).allowed,true);
 assigned.membership.assignedNavigation=[];assert.equal(policy.decision(assigned,permission).allowed,false);
 assert.ok(!navigation.navigationFor(context('accountant')).some(item=>['campaigns','templates','whatsapp-qr'].includes(item.key)));
});
