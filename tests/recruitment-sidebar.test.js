'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const navigation=require('../modules/platform/navigation');
const {salemaxSales}=require('../modules/platform/categories');

function ownerNavigation(){
  const context={audience:'tenant',tenant:{id:'tenant-1',status:'active',categoryKey:salemaxSales.key,categoryVersion:salemaxSales.version},
    category:salemaxSales,subscription:{status:'active',capabilities:[...salemaxSales.capabilities]},
    membership:{id:'owner-1',tenantId:'tenant-1',role:'owner',status:'active'}};
  return navigation.navigationFor(context).map(item=>item.key);
}

test('SaleMaX Sales owner has a permission-backed Applications & CVs sidebar entry',()=>{
  const sidebar=fs.readFileSync(path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
  assert.ok(ownerNavigation().includes('recruitment'));
  assert.match(sidebar,/membershipRole==='owner'\?\[\['recruitment','Candidate Applications','طلبات التوظيف','recruitment'\]\]:\[\]/);
  assert.match(sidebar,/'Candidate Applications':'recruitment'/);
  assert.match(sidebar,/forms:'forms',recruitment:'recruitment'/);
  assert.match(sidebar,/'Applications & CVs':'Candidate Applications'/);
  assert.match(sidebar,/function dedupeRecruitmentNavigationRows\(list\)/);
  assert.ok(sidebar.indexOf('dedupeRecruitmentNavigationRows(list);')>sidebar.indexOf('ensureSalesNavigationRows(list);'));
});
