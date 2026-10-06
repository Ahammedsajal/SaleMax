'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const policies=require('../modules/platform/training-finance-policies');
const finance=require('../modules/platform/finance-contract');
const valid={legalName:'Salemax Training Center LLC',legalRegistrationNumber:'CR-1042',legalAddress:'Doha, Qatar',invoicePrefix:'TC-26',taxMode:'no_tax',taxRateBps:null,revenueMethod:'deferred_until_delivery',issueApprover:'accountant',manualSecondApprovalAboveMinor:500000};
function context(role='owner',capabilities=['tenant.settings','finance.invoices']){return {audience:'tenant',identity:{id:'identity-'+role},tenant:{id:'tenant-1',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-'+role,tenantId:'tenant-1',role,status:'active'},category:{key:'training_center',version:1,capabilities:['tenant.settings','finance.invoices']},subscription:{status:'active',capabilities},runtimeReady:{}};}

test('finance policy input fixes Qatar/QAR server-side and validates selectable policy values',()=>{
  const normalized=policies.normalize(valid);assert.equal(normalized.jurisdiction,'QA');assert.equal(normalized.currency,'QAR');assert.equal(normalized.legalName,valid.legalName);
  assert.deepEqual(finance.policyConfigurationIssues(normalized),[]);
  for(const input of [{...valid,invoicePrefix:'a/b'},{...valid,taxMode:'no_tax',taxRateBps:500},{...valid,taxMode:'exclusive',taxRateBps:null},{...valid,taxRateBps:10001},{...valid,manualSecondApprovalAboveMinor:1.5},{...valid,currency:'USD'},{...valid,approvedByRole:'accountant'}])assert.throws(()=>policies.normalize(input));
  assert.deepEqual(finance.policyConfigurationIssues(policies.normalize({...valid,taxMode:'unset',taxRateBps:null})),['TAX_POLICY_REQUIRED']);
});

test('finance policy permissions fail closed for agents, managers, unrelated tenants and missing plan features',async()=>{
  const noDb={query(){throw Error('database must not be touched before authorization')}};
  assert.throws(()=>policies.requireAccess(context('agent'),'configure'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>policies.requireAccess(context('manager'),'configure'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>policies.requireAccess(context('accountant'),'configure'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>policies.requireAccess({...context('accountant'),tenant:{...context('accountant').tenant,id:'other'}},'approve'),{code:'TENANT_CONTEXT_REQUIRED'});
  assert.throws(()=>policies.requireAccess(context('owner',['tenant.settings']),'read'),{code:'FEATURE_UNAVAILABLE'});
  await assert.rejects(policies.get(noDb,{...context('agent'),membership:{...context('agent').membership,role:'agent'}}),{code:'PERMISSION_DENIED'});
  assert.doesNotThrow(()=>policies.requireAccess(context('accountant'),'approve'));
});

test('legacy finance policy API remains mounted while its confusing policy editor is absent from the finance screen',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const router=read('modules/platform/training-finance-router.js'),mount=read('modules/platform/mount-existing-upgrade.js'),ui=read('client/public/training-finance.js'),html=read('client/public/index.html'),sidebar=read('client/public/training-sidebar.js');
  assert.match(router,/\/accountant\/current/);assert.match(router,/canonicalGuard/);assert.match(router,/\/decision/);
  assert.match(mount,/\/api\/user\/training\/finance-policies/);assert.match(mount,/businessBoundary\.guard/);
  assert.match(html,/training-finance\.js\?v=/);assert.match(ui,/finance-settings/);assert.match(ui,/المالية/);assert.doesNotMatch(ui,/Request accountant review|Tenant policy draft|Revenue recognition|Policy history/);assert.match(ui,/X-CSRF-Token/);assert.match(ui,/Loading finance settings/);
  assert.match(ui,/Finance Reports/);assert.match(ui,/data-sx-finance-report-nav/);assert.match(ui,/billedMinor/);assert.match(ui,/creditedInvoiceCount/);assert.match(ui,/name="from"/);assert.match(ui,/name="to"/);
  assert.match(sidebar,/finance-settings&section=reports/);assert.match(sidebar,/Lead Reports/);assert.match(sidebar,/Leads & Reports/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Legacy training-center finance policy API/);assert.match(read('docs/USER_MANUAL.md'),/Center details on invoices/);
});
