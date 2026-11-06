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
    const [[order]] = await db.query('SELECT status,fulfillment,driver_id AS driver,order_lines AS orderLines FROM sx_retail_orders WHERE tenant_id=? AND id=? FOR UPDATE', [tenant,id]);
    if (!order || (driver && order.driver !== actor.membershipId)) fail('ORDER_NOT_FOUND', 404);
    if (order.status === next) return {status: next};
    const allowed = {placed: ['ready','cancelled'], ready: order.fulfillment === 'delivery' ? ['dispatched','cancelled'] : ['completed','cancelled'], dispatched: ['completed'], completed: ['returned']};
    if (!allowed[order.status]?.includes(next) || (driver && !['dispatched','completed'].includes(next)) || (next === 'dispatched' && !order.driver)) fail('INVALID_TRANSITION', 409);
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
      const request=randomUUID();
      for(const line of lines){
        await lockProduct(db,tenant,line.id,false);
        await move(db,tenant,line.id,request,actor.identityId,line.quantity,'Retail order returned');
      }
    }
    await db.query('UPDATE sx_retail_orders SET status=? WHERE tenant_id=? AND id=?', [next,tenant,id]);
    return {status: next};
  });
}
module.exports = {getStore, browse, checkout, transition, transaction, lockProduct, fail, string, uuid, slugPattern};
