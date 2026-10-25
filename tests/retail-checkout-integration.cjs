'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const retail=require('../modules/platform/retail-orders');
const categories=require('../modules/platform/categories');
const branches=require('../modules/platform/tenant-branches');

module.exports=async function retailCheckoutIntegration(connection,other,{identityId}){
  const tenantId=crypto.randomUUID(),membershipId=crypto.randomUUID(),branchId=crypto.randomUUID(),productId=crypto.randomUUID();
  const tenantSlug=`synthetic-retail-${crypto.randomUUID().slice(0,8)}`;
  await connection.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,?,?,'retail_boutique',1,'active')",[tenantId,tenantSlug,'Synthetic Retail']);
  await connection.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[membershipId,tenantId,identityId]);
  const ctx={audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:'retail_boutique',categoryVersion:1},membership:{id:membershipId,tenantId,role:'owner',status:'active'},category:categories.retailBoutique,subscription:{status:'active',categoryKey:'retail_boutique',categoryVersion:1,capabilities:['products.catalog','retail.orders']}};
  const branch=await branches.create(connection,ctx,{slug:'doha',nameEn:'Doha',addressEn:'Doha',fulfillmentModes:['pickup'],publicEnabled:true});
  assert.equal(branch.status,'active');assert.equal(branch.publicEnabled,true);
  await connection.query(`INSERT INTO sx_product_catalog(id,tenant_id,code,name_en,name_ar,description_en,description_ar,duration_value,duration_unit,delivery_mode,status,revision,created_by_identity_id,updated_by_identity_id)
    VALUES (?,?,?,'Synthetic item','عنصر تجريبي','','',1,'days','in_person','active',1,?,?)`,[productId,tenantId,`T-${crypto.randomUUID().slice(0,8)}`,identityId,identityId]);
  const variant=await retail.createVariant(connection,ctx,{productId,branchId:branch.id,onHand:1,sku:`SKU-${crypto.randomUUID().slice(0,8)}`,nameEn:'One unit',nameAr:'قطعة واحدة',priceMinor:1250,currency:'QAR'});
  const entitlementCaps=JSON.stringify(['products.catalog','retail.orders']);
  const withRetailEntitlement=db=>({
    beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),
    query:(sql,params)=>sql.includes('FROM sx_plan_assignments a JOIN sx_plan_versions p')
      ?Promise.resolve([[{id:'synthetic-retail-plan',status:'active',role_limits:JSON.stringify({owner:1,accountant:1,manager:1,agent:1}),capabilities:entitlementCaps,category_key:'retail_boutique',category_version:1,current_period:1}]])
      :db.query(sql,params)
  });
  const base={customerName:'Synthetic guest',customerMobile:'+97455550001',fulfillmentMode:'pickup',branchSlug:'doha',deliveryAddress:'',paymentMethod:'cash_on_delivery',items:[{variantId:variant.id,quantity:1}],guestAccessToken:'R'.repeat(43),consent:true};
  const requests=[{...base,requestKey:crypto.randomUUID()},{...base,requestKey:crypto.randomUUID()}];
  const attempts=await Promise.allSettled([
    retail.checkout(withRetailEntitlement(connection),tenantId,requests[0]),
    retail.checkout(withRetailEntitlement(other),tenantId,requests[1])
  ]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1,`only one simultaneous guest order can reserve the final unit: ${JSON.stringify(attempts.map(result=>result.status==='fulfilled'?{status:result.status,result:result.value}:{status:result.status,code:result.reason?.code,message:result.reason?.message}))}`);
  const rejected=attempts.find(result=>result.status==='rejected');assert.equal(rejected.reason.code,'RETAIL_STOCK_UNAVAILABLE');
  const winningIndex=attempts[0].status==='fulfilled'?0:1,winningOrder=attempts[winningIndex].value;
  const replay=await retail.checkout(withRetailEntitlement(other),tenantId,requests[winningIndex]);
  assert.equal(replay.repeated,true);assert.equal(replay.orderId,winningOrder.orderId,'a real MariaDB retry returns the original order');
  const [[stock]]=await connection.query('SELECT on_hand AS onHand,reserved FROM sx_retail_stock WHERE tenant_id=? AND variant_id=? AND branch_id=?',[tenantId,variant.id,branch.id]);
  assert.equal(Number(stock.onHand),1);assert.equal(Number(stock.reserved),1);
  const [[orders]]=await connection.query('SELECT COUNT(*) AS total FROM sx_retail_orders WHERE tenant_id=?',[tenantId]);assert.equal(Number(orders.total),1);
  const [[items]]=await connection.query('SELECT COUNT(*) AS total FROM sx_retail_order_items WHERE tenant_id=?',[tenantId]);assert.equal(Number(items.total),1);
  return {retailCheckoutUsesSyntheticPlanEntitlement:true,retailGuestCheckoutUsesMariaDbTransactions:true,retailConcurrentLastUnitReservedOnce:true,retailOrderIdempotencyReturnsOriginal:true,retailOrderAndItemPersistAtomically:true};
};
