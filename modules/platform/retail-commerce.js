'use strict';

const {randomUUID, createHash} = require('node:crypto');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), {code, status}); };
const string = (value, max, required = true) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail('INVALID_INPUT');
  return value.trim();
};
const productQuery = `SELECT p.id, p.name_en AS nameEn, p.name_ar AS nameAr, l.category, l.photo_id AS photoId,
  p.description_en AS descriptionEn, p.description_ar AS descriptionAr, o.price_minor AS priceMinor,
  COALESCE((SELECT quantity FROM sx_business_stock_movements m
    WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id ORDER BY m.id DESC LIMIT 1),0) - COALESCE((SELECT SUM(r.quantity) FROM sx_retail_stock_reservations r
    WHERE r.tenant_id=p.tenant_id AND r.product_id=p.id),0) AS quantity
  FROM sx_retail_listings l JOIN sx_product_catalog p ON p.tenant_id=l.tenant_id AND p.id=l.product_id
  JOIN sx_product_offers o ON o.id=(
    SELECT id FROM sx_product_offers WHERE tenant_id=p.tenant_id AND course_id=p.id AND status='active'
    AND currency='QAR' AND (valid_from IS NULL OR valid_from<=CURRENT_DATE)
    AND (valid_until IS NULL OR valid_until>=CURRENT_DATE) ORDER BY version DESC LIMIT 1)
  WHERE l.tenant_id=? AND l.published=1 AND p.deleted_at IS NULL AND p.status='active'`;
const storeQuery = `SELECT s.tenant_id AS tenantId,s.slug,s.title,s.about,s.contact,s.delivery_fee AS deliveryFee,s.delivery_zones AS deliveryZones
  FROM sx_retail_store s JOIN sx_tenants t ON t.id=s.tenant_id AND t.status='active'
  WHERE s.slug=? AND s.enabled=1 AND t.category_key='retail_boutique'
  AND EXISTS (SELECT 1 FROM sx_plan_assignments a JOIN sx_plan_versions v ON v.id=a.plan_version_id
    WHERE a.tenant_id=t.id AND a.current_tenant IS NOT NULL AND a.status IN ('active','trial','grace') AND a.effective_from<=UTC_TIMESTAMP()
    AND (a.expires_at IS NULL OR a.expires_at>UTC_TIMESTAMP()) AND v.status='published'
    AND v.category_key=t.category_key AND v.category_version=t.category_version
    AND JSON_CONTAINS(v.capabilities,JSON_QUOTE('retail.commerce')))`;

async function transaction(pool, fn) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { db.release(); }
}
async function getStore(db, slug, lock = false) {
  if (!slugPattern.test(slug)) fail('STORE_NOT_FOUND', 404);
  const [[store]] = await db.query(storeQuery + (lock ? ' FOR UPDATE' : ''), [slug]);
  if (!store) fail('STORE_NOT_FOUND', 404);
  return {...store,deliveryZones:typeof store.deliveryZones==='string'?JSON.parse(store.deliveryZones):store.deliveryZones||[]};
}
async function browse(pool, slug) {
  const {tenantId, ...store} = await getStore(pool, slug);
  const [items] = await pool.query(productQuery + ' ORDER BY l.category,p.name_en,p.id LIMIT 500', [tenantId]);
  return {store, items: items.map(({quantity, ...item}) => ({...item, available: Number(quantity) > 0}))};
}
function checkoutInput(input) {
  if (!input || !uuid.test(input.requestId || '') || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 30 ||
      !['delivery', 'pickup'].includes(input.fulfillment) || !Number.isSafeInteger(input.expectedTotal)) fail('INVALID_ORDER');
  const name = string(input.name, 120);
  const phone = string(input.phone, 30);
  if (!/^\+?[0-9 ()-]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7) fail('INVALID_PHONE');
  const address = input.fulfillment === 'delivery' ? string(input.address, 500) : '';
  const zone=input.fulfillment==='delivery'?string(input.zone??'',100,false):'';
  const rawPin=input.fulfillment==='delivery'?string(input.pin??'',48,false):'';
  let pin=null;
  if(rawPin){
    const match=rawPin.match(/^(-?\d{1,3}(?:\.\d{1,8})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,8})?)$/);
    if(!match||Math.abs(Number(match[1]))>90||Math.abs(Number(match[2]))>180)fail('INVALID_PIN');
    pin=Number(match[1])+','+Number(match[2]);
  }
  const lines = input.lines.map(line => {
    if (!line || !uuid.test(line.id || '') || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) fail('INVALID_ORDER');
    return {id: line.id.toLowerCase(), quantity: line.quantity};
  }).sort((a,b) => a.id.localeCompare(b.id));
  if (new Set(lines.map(line => line.id)).size !== lines.length) fail('INVALID_ORDER');
  return {name, phone, address, pin, zone, fulfillment: input.fulfillment, lines, expectedTotal: input.expectedTotal, requestId: input.requestId.toLowerCase()};
}
async function lockProduct(db, tenant, product, active = true) {
  const [[row]] = await db.query('SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=?' +
    (active ? " AND status='active' AND deleted_at IS NULL" : '') + ' FOR UPDATE', [tenant, product]);
  if (!row) fail('PRODUCT_UNAVAILABLE', 409);
}
async function move(db, tenant, product, request, actor, delta, reason) {
  const [[last]] = await db.query(
    'SELECT CAST(id AS CHAR) AS revision,quantity FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',
    [tenant, product]);
  const previous = Number(last?.quantity || 0), next = previous + delta;
  if (next < 0 || next > 1000000000) fail('STOCK_CHANGED', 409);
  await db.query(`INSERT INTO sx_business_stock_movements
    (tenant_id,product_id,request_id,actor_id,previous_revision,previous_quantity,quantity,reason) VALUES (?,?,?,?,?,?,?,?)`,
    [tenant, product, request, actor, last?.revision || '0', previous, next, reason]);
}
function returnInput(input) {
  if(!input||!uuid.test(input.requestId||'')||typeof input.restock!=='boolean'||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>30)fail('INVALID_RETURN');
  const reason=string(input.reason,200);
  const lines=input.lines.map(line=>{
    if(!line||!uuid.test(line.id||'')||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>100)fail('INVALID_RETURN');
    return {id:line.id.toLowerCase(),quantity:line.quantity};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(lines.map(line=>line.id)).size!==lines.length)fail('INVALID_RETURN');
  return {requestId:input.requestId.toLowerCase(),reason,restock:input.restock,lines};
}
async function returnItems(pool,tenant,actor,orderId,input) {
  if(!uuid.test(orderId))fail('ORDER_NOT_FOUND',404);
  const request=returnInput(input);
  const hash=createHash('sha256').update(JSON.stringify({orderId,request})).digest('hex');
  return transaction(pool,async db=>{
    const [[business]]=await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenant]);
    if(!business)fail('ORDER_NOT_FOUND',404);
    const [[prior]]=await db.query('SELECT id,request_hash AS hash,restocked FROM sx_retail_returns WHERE tenant_id=? AND request_id=? FOR UPDATE',[tenant,request.requestId]);
    if(prior){if(prior.hash!==hash)fail('REQUEST_CONFLICT',409);return {id:prior.id,restocked:Boolean(prior.restocked),replayed:true};}
    const [[order]]=await db.query('SELECT status,order_lines AS orderLines FROM sx_retail_orders WHERE tenant_id=? AND id=? FOR UPDATE',[tenant,orderId]);
    if(!order||!['completed','partially_returned'].includes(order.status))fail('RETURN_UNAVAILABLE',409);
    const purchased=typeof order.orderLines==='string'?JSON.parse(order.orderLines):order.orderLines;
    const purchasedById=new Map(purchased.map(line=>[line.id,{quantity:Number(line.quantity),priceMinor:Number(line.priceMinor)}]));
    const [priorLines]=await db.query('SELECT product_id AS productId,SUM(quantity) AS quantity FROM sx_retail_return_lines WHERE tenant_id=? AND order_id=? GROUP BY product_id',[tenant,orderId]);
    const alreadyReturned=new Map(priorLines.map(line=>[line.productId,Number(line.quantity)]));
    for(const line of request.lines){
      const original=purchasedById.get(line.id);
      if(!original||line.quantity>original.quantity-(alreadyReturned.get(line.id)||0))fail('RETURN_QUANTITY_EXCEEDED',409);
    }
    const id=randomUUID();
    await db.query('INSERT INTO sx_retail_returns (id,tenant_id,order_id,request_id,request_hash,reason,restocked,created_by_identity_id) VALUES (?,?,?,?,?,?,?,?)',
      [id,tenant,orderId,request.requestId,hash,request.reason,request.restock,actor.identityId]);
    for(const line of request.lines){
      await db.query('INSERT INTO sx_retail_return_lines (tenant_id,return_id,order_id,product_id,quantity) VALUES (?,?,?,?,?)',[tenant,id,orderId,line.id,line.quantity]);
      if(request.restock){
        await lockProduct(db,tenant,line.id,false);
        await move(db,tenant,line.id,id,actor.identityId,line.quantity,'Retail return: '+request.reason);
      }
    }
    const returnedTotal=[...alreadyReturned.values()].reduce((sum,value)=>sum+value,0)+request.lines.reduce((sum,line)=>sum+line.quantity,0);
    const purchasedTotal=purchased.reduce((sum,line)=>sum+Number(line.quantity),0);
    const status=returnedTotal===purchasedTotal?'returned':'partially_returned';
    await db.query('UPDATE sx_retail_orders SET status=? WHERE tenant_id=? AND id=?',[status,tenant,orderId]);
    return {id,status,restocked:request.restock,replayed:false};
  });
}
async function recordCashReceipt(pool,tenant,actor,orderId,input,driver=false) {
  if(!uuid.test(orderId)||!input||!uuid.test(input.requestId||'')||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<0)fail('INVALID_CASH_RECEIPT');
  const requestId=input.requestId.toLowerCase();
  return transaction(pool,async db=>{
    const [[order]]=await db.query('SELECT status,fulfillment,driver_id AS driver,total_minor AS total FROM sx_retail_orders WHERE tenant_id=? AND id=? FOR UPDATE',[tenant,orderId]);
    if(!order)fail('ORDER_NOT_FOUND',404);
    if((driver||actor.role==='agent')&&(!order.driver||order.driver!==actor.membershipId||order.fulfillment!=='delivery'))fail('ORDER_NOT_FOUND',404);
    const collector=order.fulfillment==='delivery'?order.driver:actor.membershipId;
    if(!collector)fail('CASH_RECORD_UNAVAILABLE',409);
    const hash=createHash('sha256').update(JSON.stringify({orderId,amountMinor:input.amountMinor,collector,identityId:actor.identityId})).digest('hex');
    const [[byRequest]]=await db.query('SELECT id,request_hash AS hash FROM sx_retail_cash_receipts WHERE tenant_id=? AND request_id=? FOR UPDATE',[tenant,requestId]);
    if(byRequest){if(byRequest.hash!==hash)fail('REQUEST_CONFLICT',409);return {id:byRequest.id,received:true,replayed:true};}
    const [[byOrder]]=await db.query('SELECT id,amount_minor AS amount FROM sx_retail_cash_receipts WHERE tenant_id=? AND order_id=? FOR UPDATE',[tenant,orderId]);
    if(byOrder){if(Number(byOrder.amount)!==input.amountMinor)fail('CASH_ALREADY_RECORDED',409);return {id:byOrder.id,received:true,replayed:true};}
    if(!((order.fulfillment==='delivery'&&order.status==='dispatched')||(order.fulfillment==='pickup'&&order.status==='ready')))fail('CASH_RECORD_UNAVAILABLE',409);
    if(!Number.isSafeInteger(Number(order.total))||input.amountMinor!==Number(order.total))fail('CASH_AMOUNT_MISMATCH',409);
    const id=randomUUID();
    await db.query('INSERT INTO sx_retail_cash_receipts (id,tenant_id,order_id,request_id,request_hash,amount_minor,collector_membership_id,recorded_by_identity_id) VALUES (?,?,?,?,?,?,?,?)',
      [id,tenant,orderId,requestId,hash,input.amountMinor,collector,actor.identityId]);
    await db.query('UPDATE sx_retail_orders SET cash_received_by=?,cash_received_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[actor.identityId,tenant,orderId]);
    return {id,received:true,replayed:false};
  });
}
async function recordSettlement(pool,tenant,actor,input) {
  if(!input||!uuid.test(input.requestId||'')||!uuid.test(input.driverId||'')||!Array.isArray(input.orderIds)||!input.orderIds.length||input.orderIds.length>100||
    !Number.isSafeInteger(input.countedMinor)||input.countedMinor<0)fail('INVALID_SETTLEMENT');
  const orderIds=input.orderIds.map(id=>{if(!uuid.test(id))fail('INVALID_SETTLEMENT');return id.toLowerCase();}).sort();
  if(new Set(orderIds).size!==orderIds.length)fail('INVALID_SETTLEMENT');
  const requestId=input.requestId.toLowerCase(),driverId=input.driverId.toLowerCase();
  const request={driverId,orderIds,countedMinor:input.countedMinor};
  const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return transaction(pool,async db=>{
    const [[business]]=await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenant]);
    if(!business)fail('SETTLEMENT_ORDERS_UNAVAILABLE',409);
    const [[prior]]=await db.query('SELECT id,request_hash AS hash,expected_minor AS expected,counted_minor AS counted,status FROM sx_retail_cash_settlements WHERE tenant_id=? AND request_id=? FOR UPDATE',[tenant,requestId]);
    if(prior){if(prior.hash!==hash)fail('REQUEST_CONFLICT',409);return {id:prior.id,expectedMinor:Number(prior.expected),countedMinor:Number(prior.counted),status:prior.status,replayed:true};}
    const [[driverMember]]=await db.query("SELECT id FROM sx_memberships WHERE tenant_id=? AND id=? AND role='agent' FOR UPDATE",[tenant,driverId]);
    if(!driverMember)fail('DRIVER_UNAVAILABLE',409);
    const [rows]=await db.query(`SELECT o.id,o.status,o.fulfillment,o.driver_id AS driver,r.amount_minor AS amount,r.settlement_id AS settlement
      FROM sx_retail_orders o JOIN sx_retail_cash_receipts r ON r.tenant_id=o.tenant_id AND r.order_id=o.id
      WHERE o.tenant_id=? AND o.id IN (?) ORDER BY o.id FOR UPDATE`,[tenant,orderIds]);
    if(rows.length!==orderIds.length||rows.some(row=>!['completed','partially_returned','returned'].includes(row.status)||row.fulfillment!=='delivery'||row.driver!==driverId||row.settlement))fail('SETTLEMENT_ORDERS_UNAVAILABLE',409);
    const expectedBig=rows.reduce((sum,row)=>sum+BigInt(row.amount),0n);
    if(expectedBig>BigInt(Number.MAX_SAFE_INTEGER))fail('SETTLEMENT_TOO_LARGE',409);
    const expectedMinor=Number(expectedBig),status=input.countedMinor===expectedMinor?'matched':'variance',id=randomUUID();
    await db.query('INSERT INTO sx_retail_cash_settlements (id,tenant_id,request_id,request_hash,driver_membership_id,expected_minor,counted_minor,status,recorded_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [id,tenant,requestId,hash,driverId,expectedMinor,input.countedMinor,status,actor.identityId]);
    for(const row of rows)await db.query('INSERT INTO sx_retail_cash_settlement_orders (tenant_id,settlement_id,order_id,amount_minor) VALUES (?,?,?,?)',[tenant,id,row.id,row.amount]);
    if(status==='matched'){
      const [updated]=await db.query('UPDATE sx_retail_cash_receipts SET settlement_id=?,settled_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND order_id IN (?) AND settlement_id IS NULL',[id,tenant,orderIds]);
      if(updated.affectedRows!==orderIds.length)fail('SETTLEMENT_ORDERS_UNAVAILABLE',409);
    }
    return {id,expectedMinor,countedMinor:input.countedMinor,status,replayed:false};
  });
}
async function checkout(pool, slug, input) {
  const order = checkoutInput(input);
  const hash = createHash('sha256').update(JSON.stringify(order)).digest('hex');
  return transaction(pool, async db => {
    const store = await getStore(db, slug, true);
    const [[prior]] = await db.query('SELECT id,request_hash AS hash,total_minor AS total FROM sx_retail_orders WHERE tenant_id=? AND request_id=? FOR UPDATE', [store.tenantId, order.requestId]);
    if (prior) {
      if (prior.hash !== hash) fail('REQUEST_CONFLICT', 409);
      return {reference: prior.id, totalMinor: Number(prior.total)};
    }
    const zone=store.deliveryZones.find(item=>item.name===order.zone);
    if(order.fulfillment==='delivery'&&(store.deliveryZones.length?!zone:store.deliveryFee===null)) fail('DELIVERY_UNAVAILABLE',409);
    for (const line of order.lines) await lockProduct(db, store.tenantId, line.id);
    const [items] = await db.query(productQuery + ' AND p.id IN (?)', [store.tenantId, order.lines.map(line => line.id)]);
    const index = new Map(items.map(item => [item.id, item]));
    const lines = order.lines.map(line => {
      const item = index.get(line.id);
      if (!item) fail('PRODUCT_UNAVAILABLE', 409);
      return {...line, nameEn: item.nameEn, nameAr: item.nameAr, priceMinor: Number(item.priceMinor)};
    });
    const fee = order.fulfillment === 'delivery' ? Number(zone?.feeMinor??store.deliveryFee) : 0;
    const total = lines.reduce((sum, line) => sum + line.priceMinor * line.quantity, fee);
    if (!Number.isSafeInteger(total) || total !== order.expectedTotal) fail('PRICE_CHANGED', 409);
    const id = randomUUID();
    for (const line of lines) {
      if (Number(index.get(line.id).quantity) < line.quantity) fail('STOCK_CHANGED',409);
      await db.query('INSERT INTO sx_retail_stock_reservations (tenant_id,product_id,order_id,quantity) VALUES (?,?,?,?)',
        [store.tenantId,line.id,id,line.quantity]);
    }
    await db.query(`INSERT INTO sx_retail_orders
      (id,tenant_id,request_id,request_hash,buyer_name,buyer_phone,delivery_address,delivery_pin,delivery_zone,fulfillment,order_lines,total_minor,delivery_fee)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, store.tenantId, order.requestId, hash, order.name, order.phone, order.address, order.pin, zone?.name||null, order.fulfillment, JSON.stringify(lines), total, fee]);
    return {reference: id, totalMinor: total};
  });
}
async function transition(pool, tenant, actor, id, next, driver) {
  if (!uuid.test(id)) fail('ORDER_NOT_FOUND', 404);
  return transaction(pool, async db => {
    const [[order]] = await db.query('SELECT status,fulfillment,driver_id AS driver,order_lines AS orderLines,total_minor AS total FROM sx_retail_orders WHERE tenant_id=? AND id=? FOR UPDATE', [tenant,id]);
    if (!order || (driver && order.driver !== actor.membershipId)) fail('ORDER_NOT_FOUND', 404);
    if (order.status === next) return {status: next};
    const allowed = {placed: ['ready','cancelled'], ready: order.fulfillment === 'delivery' ? ['dispatched','cancelled'] : ['completed','cancelled'], dispatched: ['completed'], completed: ['returned'], partially_returned:['returned']};
    if (!allowed[order.status]?.includes(next) || (driver && !['dispatched','completed'].includes(next)) || (next === 'dispatched' && !order.driver)) fail('INVALID_TRANSITION', 409);
    if(next==='completed'){
      const [[receipt]]=await db.query('SELECT amount_minor AS amount FROM sx_retail_cash_receipts WHERE tenant_id=? AND order_id=? FOR UPDATE',[tenant,id]);
      if(!receipt||Number(receipt.amount)!==Number(order.total))fail('CASH_RECEIPT_REQUIRED',409);
    }
    if(next==='cancelled'){
      const [[receipt]]=await db.query('SELECT id FROM sx_retail_cash_receipts WHERE tenant_id=? AND order_id=? FOR UPDATE',[tenant,id]);
      if(receipt)fail('CASH_RECEIPT_RECORDED',409);
    }
    if (next === 'cancelled' || next === 'completed') {
      const lines = typeof order.orderLines === 'string' ? JSON.parse(order.orderLines) : order.orderLines;
      for (const line of lines) {
        await lockProduct(db, tenant, line.id, false);
        if (next === 'completed') await move(db, tenant, line.id, id, actor.identityId, -line.quantity, 'Retail order fulfilled');
        const [deleted] = await db.query('DELETE FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? AND order_id=?',
          [tenant,line.id,id]);
        if (deleted.affectedRows!==1) fail('RESERVATION_MISSING',409);
      }
    }
    if(next==='returned'){
      const lines=typeof order.orderLines==='string'?JSON.parse(order.orderLines):order.orderLines;
      const [priorLines]=await db.query('SELECT product_id AS productId,SUM(quantity) AS quantity FROM sx_retail_return_lines WHERE tenant_id=? AND order_id=? GROUP BY product_id',[tenant,id]);
      const alreadyReturned=new Map(priorLines.map(line=>[line.productId,Number(line.quantity)]));
      const remaining=lines.map(line=>({id:line.id,quantity:Number(line.quantity)-(alreadyReturned.get(line.id)||0)})).filter(line=>line.quantity>0);
      if(remaining.length){
        const request=randomUUID(),returnId=randomUUID(),requestHash=createHash('sha256').update(JSON.stringify({orderId:id,returnId,remaining,restock:true})).digest('hex');
        await db.query('INSERT INTO sx_retail_returns (id,tenant_id,order_id,request_id,request_hash,reason,restocked,created_by_identity_id) VALUES (?,?,?,?,?,?,?,?)',
          [returnId,tenant,id,request,requestHash,'Full return',1,actor.identityId]);
        for(const line of remaining){
          await lockProduct(db,tenant,line.id,false);
          await db.query('INSERT INTO sx_retail_return_lines (tenant_id,return_id,order_id,product_id,quantity) VALUES (?,?,?,?,?)',[tenant,returnId,id,line.id,line.quantity]);
          await move(db,tenant,line.id,returnId,actor.identityId,line.quantity,'Retail order returned');
        }
      }
    }
    await db.query('UPDATE sx_retail_orders SET status=? WHERE tenant_id=? AND id=?', [next,tenant,id]);
    return {status: next};
  });
}
module.exports = {getStore, browse, checkout, transition, returnItems, recordCashReceipt, recordSettlement, transaction, lockProduct, fail, string, uuid, slugPattern};
