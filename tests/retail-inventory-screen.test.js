'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../client/public');
const screen=fs.readFileSync(path.join(root,'inventory/inventory.js'),'utf8');
const html=fs.readFileSync(path.join(root,'inventory/index.html'),'utf8');
const shell=fs.readFileSync(path.join(root,'pipeline-entry.js'),'utf8');
const sidebar=fs.readFileSync(path.join(root,'training-sidebar.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const mount=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8');

test('Retail inventory opens inside the existing authenticated business panel',()=>{
  assert.match(index,/pipeline-entry\.js\?v=20261022-retail-inventory2/);
  assert.match(index,/training-sidebar\.js\?v=20261022-retail-inventory2/);
  assert.match(sidebar,/Inventory:'inventory','المخزون':'inventory'/);
  assert.match(sidebar,/inventory:'inventory'/);
  assert.match(shell,/get\('page'\)\s*===\s*'inventory'/);
  assert.match(shell,/salemax-inventory-workspace/);
  assert.match(shell,/\/inventory\/\?embed=1/);
  assert.match(mount,/app\.get\('\/inventory\//);
  assert.match(mount,/\/api\/workspace\/inventory/);
});

test('screen uses authenticated category and permissions and has English and Arabic controls',()=>{
  assert.match(html,/Inventory · 7Network/);
  assert.match(html,/workspace-api\.js\?v=20261022-retail-inventory1/);
  assert.match(screen,/SaleMaxWorkspace\.session\(\)/);
  assert.match(screen,/session\.categoryKey!==\s*'retail_shop'/);
  assert.match(screen,/inventory\.adjust/);
  assert.match(screen,/\/stock\?locationId=/);
  assert.match(screen,/\/adjustments/);
  assert.match(screen,/\/movements\?locationId=/);
  assert.match(screen,/expectedRevision:item\.revision/);
  assert.match(screen,/requestKey:crypto\.randomUUID\(\)/);
  assert.match(screen,/تابع كميات المنتجات حسب موقع المتجر/);
  assert.match(screen,/تسوية المخزون/);
  assert.match(screen,/تغيير المخزون هو الكمية المضافة أو المسحوبة/);
  assert.match(screen,/We could not load or save inventory right now/);
});
