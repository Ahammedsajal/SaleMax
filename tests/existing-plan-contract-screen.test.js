'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'client/public/index.html'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'client/public/admin-plan-editor.js'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'client/public/admin-plan-contracts.js'), 'utf8');
const userPlans = fs.readFileSync(path.join(root, 'client/public/admin-user-plans.js'), 'utf8');

test('contract draft editing is mounted inside the original Manage Plans screen', () => {
  assert.match(shell, /src="\/admin-plan-contracts\.js/);
  assert.match(editor, /salemaxPlanContracts\?\.mount\(active,plan\)/);
  assert.match(contracts, /data-edit=/);
  assert.match(contracts, /Edit draft/);
  assert.match(contracts, /تعديل المسودة/);
  assert.match(contracts, /draft\.dataset\.editRevision/);
  assert.match(contracts, /'PUT'/);
  assert.match(contracts, /STALE_REVISION/);
  assert.match(contracts, /UNSAVED_DRAFT/);
  assert.match(contracts, /UNSAVED_DRAFT_LANGUAGE/);
  assert.match(contracts, /stopImmediatePropagation/);
  assert.match(contracts, /Cancel editing/);
  assert.match(contracts, /احفظ تغييرات المسودة أو تجاهلها قبل مراجعة النشر/);
  assert.match(contracts, /تحديث تغييرات المسودة|حفظ تغييرات المسودة/);
  assert.match(contracts, /REAUTH_REQUIRED:t\('Your password sign-in expired/);
  assert.match(contracts, /Complete verification within five minutes of signing in/);
  assert.match(contracts, /reauth\.onclick=signIn/);
  assert.match(contracts, /امسح رمز QR الجديد/);
});

test('Manage Plans contract editor offers the private 7Network Sales category from the authorized existing-plan API',()=>{
  const router=fs.readFileSync(path.join(root,'modules/platform/existing-catalogue-router.js'),'utf8');
  const bridge=fs.readFileSync(path.join(root,'modules/platform/catalogue-bridge.js'),'utf8');
  assert.match(router,/const categories=availableCategories\(req\.businessContext\)/);
  assert.match(router,/res\.json\(\{category:categories\[0\],categories/);
  assert.match(router,/platformDecision\(ctx,'categories\.manage'\)/);
  assert.match(router,/categoryFor\(req\.businessContext,categoryKey,categoryVersion\)/);
  assert.match(contracts,/context\.categories\.some/);
  assert.match(contracts,/category\.features\.map/);
  assert.match(bridge,/plans\.authorizeCategory\(ctx,definition\.category\)/);
  assert.match(bridge,/v\.category_key IN \(\$\{categoryKeys\.map\(\(\)=>'\?'\)\.join\(','\)\}\) AND v\.category_version=\?/);
  assert.match(bridge,/const categoryKeys=require\('\.\/categories'\)\.categoryKeysFor\(category\.key\)/);
  assert.match(bridge,/plans\.authorizeCategory\(ctx,category\)/);
  assert.match(bridge,/plans\.authorizeCategory\(ctx,definition\.category\)/);
  assert.match(contracts,/category\.key==='7network_sales'\|\|feature\.key!=='telephony\.call-center'/);
  assert.match(contracts,/category\.features\.find\(feature=>feature\.key===capability\)/);
});

test('new 7Network Sales contract drafts include the core Call Center capability by default', () => {
  assert.match(shell, /admin-plan-contracts\.js\?v=[^" ]+/);
  assert.match(contracts, /!latest\?\(category\.key==='7network_sales'\|\|feature\.key!==['"]telephony\.call-center['"]\):latest\.capabilities\.includes\(feature\.key\)/);
  assert.match(contracts, /draft\.querySelectorAll\('\[name=capability\]'\)/);
  assert.match(contracts, /input\.checked=version\.capabilities\.includes\(input\.value\)/);
});

test('legacy Manage Users assignment denial offers the reviewed contract flow', () => {
  assert.match(shell, /admin-user-plans\.js\?v=[^" ]+/);
  assert.match(userPlans, /CANONICAL_ASSIGNMENT_REQUIRED/);
  assert.match(userPlans, /MAPPED_TENANT_REQUIRES_CONTRACT_ASSIGNMENT/);
  assert.match(userPlans, /Open training-center contract/);
  assert.match(userPlans, /فتح عقد مركز التدريب/);
  assert.match(userPlans, /openBusiness\(userId,active/);
  assert.match(userPlans, /Set up training-center account/);
  assert.match(userPlans, /مركز التدريب/);
  assert.match(userPlans, /provision-options/);
  assert.match(userPlans, /provision-preview/);
  assert.match(userPlans, /Create business and assign plan/);
  assert.match(userPlans, /إنشاء النشاط وتعيين الخطة/);
});

test('Manage Users links missing 7Network Sales contracts to the existing Manage Plans screen', () => {
  assert.match(shell, /admin-user-plans\.js\?v=20261014-sales-owner-guard1/);
  assert.match(userPlans, /No published 7Network Sales contracts are available/);
  assert.match(userPlans, /Open Manage Plans to publish a 7Network Sales contract/);
  assert.match(userPlans, /href="\/admin\?page=manage-plans"/);
  assert.match(userPlans, /افتح إدارة الخطط لنشر عقد مبيعات 7Network/);
});

test('Manage Users staff-tree observer avoids rewriting unchanged toggle text', () => {
  assert.match(shell, /admin-user-plans\.js\?v=[^" ]+/);
  assert.match(userPlans, /const toggleText=t\('Staff','الموظفون'\)\+` · \$\{staff\.length\} `\+\(expandedBusinessTeams\.has\(ownerId\)\?'⌃':'⌄'\);if\(toggle\.textContent!==toggleText\)toggle\.textContent=toggleText;/);
  assert.match(userPlans, /new MutationObserver\(mount\)\.observe\(document\.documentElement,\{subtree:true,childList:true\}\)/);
});

test('Edit User exposes the Training Center category through reviewed provisioning', () => {
  assert.match(userPlans, /function mountEditCategoryControl\(\)/);
  assert.match(userPlans, /data-sx-category-editor/);
  assert.match(userPlans, /Business category/);
  assert.match(userPlans, /Training Center/);
  assert.match(userPlans, /No category is assigned yet/);
  assert.match(userPlans, /business-contracts|protectedRequest/);
  assert.match(userPlans, /current\.linked/);
  assert.match(userPlans, /onComplete/);
  assert.match(userPlans, /فئة النشاط/);
});
