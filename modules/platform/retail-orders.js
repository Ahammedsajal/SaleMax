'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');
const plans=require('./plans');

const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const text=(value,max,code,required=true)=>{if(typeof value!=='string'||(required&&!value.trim())||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))fail(code);return value.trim();};
const money=value=>Number.isSafeInteger(value)&&value>=0&&value<=999999999999;
const allowed=(input,keys,code)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))fail(code);};

function authorize(ctx,permission){
  if(ctx?.audience!=='tenant'||ctx.tenant?.categoryKey!=='retail_boutique'||ctx.tenant?.status!=='active'||ctx.membership?.tenantId!==ctx.tenant.id||ctx.membership?.status!=='active')fail('CATEGORY_UNAVAILABLE',404);
  const capability=permission.startsWith('products.')?'products.catalog':'retail.orders';
  const access=decision(ctx,{capability,permission});
  if(!access.allowed)fail(access.code,access.code==='PERMISSION_DENIED'?403:409);
  return access.scope;
}
async function entitlement(db,tenantId){
  const current=await plans.loadEntitlements(db,tenantId);
  if(!current||!['active','trial','grace'].includes(current.status)||current.categoryKey!=='retail_boutique'||!current.capabilities.includes('retail.orders')||!current.capabilities.includes('products.catalog'))fail('FEATURE_UNAVAILABLE',409);
  return current;
}
async function audit(db,ctx,action,resourceType,resourceId,changes){
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity',?,?,?, ?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,action,resourceType,resourceId,JSON.stringify(changes),crypto.randomUUID()]);
}
async function listVariants(db,ctx){
  authorize(ctx,'products.read');
  const [rows]=await db.query(`SELECT v.id AS variantId,v.product_id AS productId,v.sku,v.name_en AS nameEn,v.name_ar AS nameAr,
      v.price_minor AS priceMinor,v.currency,v.status,v.revision,p.name_en AS productNameEn,p.name_ar AS productNameAr,
      s.id AS stockId,s.branch_id AS branchId,b.name_en AS branchNameEn,b.name_ar AS branchNameAr,s.on_hand AS onHand,s.reserved,s.revision AS stockRevision
    FROM sx_retail_variants v JOIN sx_product_catalog p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
    LEFT JOIN sx_retail_stock s ON s.tenant_id=v.tenant_id AND s.variant_id=v.id
    LEFT JOIN sx_tenant_branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
    WHERE v.tenant_id=? ORDER BY p.name_en,v.sku,b.name_en LIMIT 500`,[ctx.tenant.id]);
  return rows.map(row=>({...row,priceMinor:Number(row.priceMinor),onHand:row.onHand==null?null:Number(row.onHand),reserved:Number(row.reserved||0),revision:Number(row.revision),stockRevision:row.stockRevision==null?null:Number(row.stockRevision)}));
}
async function createVariant(db,ctx,input){
  authorize(ctx,'products.manage');allowed(input,['productId','branchId','onHand','sku','nameEn','nameAr','priceMinor','currency'],'INVALID_RETAIL_VARIANT');
  if(!uuid(input.productId)||!uuid(input.branchId)||!money(input.priceMinor)||!Number.isSafeInteger(input.onHand)||input.onHand<0||input.onHand>1000000)fail('INVALID_RETAIL_VARIANT');
  const sku=text(input.sku,80,'INVALID_RETAIL_SKU');if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sku))fail('INVALID_RETAIL_SKU');
  const nameEn=text(input.nameEn,160,'INVALID_RETAIL_VARIANT_NAME'),nameAr=text(input.nameAr||'',160,'INVALID_RETAIL_VARIANT_NAME',false);
  const currency=input.currency||'QAR';if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))fail('INVALID_RETAIL_CURRENCY');
  await db.beginTransaction();try{
    const [[product]]=await db.query("SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND status='active' AND deleted_at IS NULL FOR UPDATE",[ctx.tenant.id,input.productId]);if(!product)fail('PRODUCT_NOT_FOUND',404);
    const [[branch]]=await db.query("SELECT id FROM sx_tenant_branches WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE",[ctx.tenant.id,input.branchId]);if(!branch)fail('RETAIL_BRANCH_UNAVAILABLE',409);
    const id=crypto.randomUUID();
    try{await db.query(`INSERT INTO sx_retail_variants(id,tenant_id,product_id,sku,name_en,name_ar,price_minor,currency,created_by_identity_id,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,[id,ctx.tenant.id,input.productId,sku,nameEn,nameAr,input.priceMinor,currency,ctx.identity.id,ctx.identity.id]);}
    catch(error){if(error.code==='ER_DUP_ENTRY')fail('RETAIL_SKU_EXISTS',409);throw error;}
    await db.query(`INSERT INTO sx_retail_stock(id,tenant_id,variant_id,branch_id,on_hand,reserved,revision,updated_by_identity_id,updated_at)
      VALUES (?,?,?,?,?,0,1,?,UTC_TIMESTAMP(3))`,[crypto.randomUUID(),ctx.tenant.id,id,input.branchId,input.onHand,ctx.identity.id]);
    await audit(db,ctx,'retail.variant-created','retail-variant',id,{productId:input.productId,branchId:input.branchId,onHand:input.onHand,sku,currency});
    await db.commit();return {id,productId:input.productId,branchId:input.branchId,onHand:input.onHand,sku,nameEn,nameAr,priceMinor:input.priceMinor,currency,status:'active',revision:1};
  }catch(error){await db.rollback();throw error;}
}
async function updateVariant(db,ctx,id,input){
  authorize(ctx,'products.manage');if(!uuid(id))fail('INVALID_RETAIL_VARIANT_ID');
  allowed(input,['expectedRevision','sku','nameEn','nameAr','priceMinor','currency','status'],'INVALID_RETAIL_VARIANT');
  const expected=input.expectedRevision;if(!Number.isSafeInteger(expected)||expected<1)fail('INVALID_REVISION');
  const fields={};if(Object.hasOwn(input,'sku')){fields.sku=text(input.sku,80,'INVALID_RETAIL_SKU');if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fields.sku))fail('INVALID_RETAIL_SKU');}
  for(const key of ['nameEn','nameAr'])if(Object.hasOwn(input,key))fields[key]=text(input[key],160,'INVALID_RETAIL_VARIANT_NAME',key==='nameEn');
  if(Object.hasOwn(input,'priceMinor')){if(!money(input.priceMinor))fail('INVALID_RETAIL_PRICE');fields.priceMinor=input.priceMinor;}
  if(Object.hasOwn(input,'currency')){if(typeof input.currency!=='string'||!/^[A-Z]{3}$/.test(input.currency))fail('INVALID_RETAIL_CURRENCY');fields.currency=input.currency;}
  if(Object.hasOwn(input,'status')){if(!['active','retired'].includes(input.status))fail('INVALID_RETAIL_VARIANT_STATUS');fields.status=input.status;}
  if(!Object.keys(fields).length)fail('INVALID_RETAIL_VARIANT');
  await db.beginTransaction();try{
    const [[row]]=await db.query('SELECT revision FROM sx_retail_variants WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);
    if(!row)fail('RETAIL_VARIANT_NOT_FOUND',404);if(Number(row.revision)!==expected)fail('STALE_REVISION',409);
    if(fields.status==='retired'){const [[held]]=await db.query("SELECT COUNT(*) AS n FROM sx_retail_stock WHERE tenant_id=? AND variant_id=? AND reserved>0",[ctx.tenant.id,id]);if(Number(held.n)>0)fail('RETAIL_VARIANT_HAS_RESERVED_STOCK',409);}
    const cols={sku:'sku',nameEn:'name_en',nameAr:'name_ar',priceMinor:'price_minor',currency:'currency',status:'status'},keys=Object.keys(fields);
    try{await db.query(`UPDATE sx_retail_variants SET ${keys.map(key=>`${cols[key]}=?`).join(',')},revision=revision+1,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[...keys.map(key=>fields[key]),ctx.identity.id,ctx.tenant.id,id]);}
    catch(error){if(error.code==='ER_DUP_ENTRY')fail('RETAIL_SKU_EXISTS',409);throw error;}
    await audit(db,ctx,'retail.variant-updated','retail-variant',id,{revision:expected+1,fields:keys});await db.commit();return {id,...fields,revision:expected+1};
  }catch(error){await db.rollback();throw error;}
}
async function setStock(db,ctx,variantId,branchId,input){
  authorize(ctx,'products.manage');if(!uuid(variantId)||!uuid(branchId))fail('INVALID_RETAIL_STOCK');
  allowed(input,['onHand','expectedRevision'],'INVALID_RETAIL_STOCK');if(!Number.isSafeInteger(input.onHand)||input.onHand<0||input.onHand>1000000)fail('INVALID_RETAIL_STOCK');
  const expected=input.expectedRevision;if(!Number.isSafeInteger(expected)||expected<0)fail('INVALID_REVISION');
  await db.beginTransaction();try{
    const [[branch]]=await db.query("SELECT id FROM sx_tenant_branches WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE",[ctx.tenant.id,branchId]);if(!branch)fail('RETAIL_BRANCH_UNAVAILABLE',409);
    const [[variant]]=await db.query("SELECT id FROM sx_retail_variants WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE",[ctx.tenant.id,variantId]);if(!variant)fail('RETAIL_VARIANT_NOT_FOUND',404);
    const [[stock]]=await db.query('SELECT id,on_hand AS onHand,reserved,revision FROM sx_retail_stock WHERE tenant_id=? AND variant_id=? AND branch_id=? FOR UPDATE',[ctx.tenant.id,variantId,branchId]);
    if(Number(stock?.revision||0)!==expected)fail('STALE_REVISION',409);if(input.onHand<Number(stock?.reserved||0))fail('STOCK_BELOW_RESERVED',409);
    const revision=expected+1;
    await db.query(`INSERT INTO sx_retail_stock(id,tenant_id,variant_id,branch_id,on_hand,reserved,revision,updated_by_identity_id,updated_at)
      VALUES (?,?,?,?,?,0,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE on_hand=VALUES(on_hand),revision=VALUES(revision),updated_by_identity_id=VALUES(updated_by_identity_id),updated_at=UTC_TIMESTAMP(3)`,[crypto.randomUUID(),ctx.tenant.id,variantId,branchId,input.onHand,revision,ctx.identity.id]);
    await audit(db,ctx,'retail.stock-adjusted','retail-variant',variantId,{branchId,onHand:input.onHand,previousOnHand:Number(stock?.onHand||0),revision});
    await db.commit();return {variantId,branchId,onHand:input.onHand,reserved:Number(stock?.reserved||0),available:input.onHand-Number(stock?.reserved||0),revision};
  }catch(error){await db.rollback();throw error;}
}
async function publicCatalog(db,tenantId){
  const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' AND category_key='retail_boutique' AND category_version=1",[tenantId]);if(!tenant)return [];
  const current=await entitlement(db,tenantId);
  const [rows]=await db.query(`SELECT p.id AS productId,p.name_en AS productNameEn,p.name_ar AS productNameAr,p.description_en AS descriptionEn,p.description_ar AS descriptionAr,
      v.id AS variantId,v.sku,v.name_en AS variantNameEn,v.name_ar AS variantNameAr,v.price_minor AS priceMinor,v.currency,s.on_hand AS onHand,s.reserved,
      b.slug AS branchSlug,b.name_en AS branchNameEn,b.name_ar AS branchNameAr,b.address_en AS branchAddressEn,b.address_ar AS branchAddressAr,
      JSON_CONTAINS(b.fulfillment_modes,JSON_QUOTE('pickup')) AS pickupAvailable,JSON_CONTAINS(b.fulfillment_modes,JSON_QUOTE('delivery')) AS deliveryAvailable
    FROM sx_product_catalog p JOIN sx_retail_variants v ON v.tenant_id=p.tenant_id AND v.product_id=p.id AND v.status='active'
    JOIN sx_retail_stock s ON s.tenant_id=v.tenant_id AND s.variant_id=v.id AND s.on_hand>s.reserved
    JOIN sx_tenant_branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id AND b.status='active' AND b.public_enabled=1
    WHERE p.tenant_id=? AND p.status='active' AND p.deleted_at IS NULL
    ORDER BY p.name_en,v.name_en,b.name_en LIMIT 500`,[tenantId]);
  if(!current)return [];
  return rows.map(row=>({...row,priceMinor:Number(row.priceMinor),available:Number(row.onHand)-Number(row.reserved),pickupAvailable:Boolean(row.pickupAvailable),deliveryAvailable:Boolean(row.deliveryAvailable)}));
}
function cleanCheckout(input){
  allowed(input,['customerName','customerEmail','customerMobile','fulfillmentMode','branchSlug','deliveryAddress','paymentMethod','items','requestKey','guestAccessToken','consent'],'INVALID_RETAIL_ORDER');
  const customerName=text(input.customerName,120,'INVALID_CUSTOMER_NAME');
  const customerEmail=text(input.customerEmail||'',254,'INVALID_CUSTOMER_EMAIL',false).toLowerCase();if(customerEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))fail('INVALID_CUSTOMER_EMAIL');
  const customerMobile=text(input.customerMobile||'',20,'INVALID_CUSTOMER_MOBILE',false);if(customerMobile&&!/^\+[1-9]\d{7,14}$/.test(customerMobile))fail('INVALID_CUSTOMER_MOBILE');
  if(!customerEmail&&!customerMobile)fail('CONTACT_REQUIRED');
  if(!['pickup','delivery'].includes(input.fulfillmentMode))fail('INVALID_FULFILLMENT_MODE');
  const branchSlug=text(input.branchSlug,48,'INVALID_BRANCH');if(!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(branchSlug))fail('INVALID_BRANCH');
  const deliveryAddress=text(input.deliveryAddress||'',1000,'INVALID_DELIVERY_ADDRESS',false);if(input.fulfillmentMode==='delivery'&&!deliveryAddress)fail('DELIVERY_ADDRESS_REQUIRED');
  const paymentMethod=input.paymentMethod;if(!['cash_on_delivery','bank_transfer'].includes(paymentMethod))fail('INVALID_PAYMENT_METHOD');
  if(!Array.isArray(input.items)||input.items.length<1||input.items.length>20)fail('INVALID_ORDER_ITEMS');
  const items=input.items.map(item=>{allowed(item,['variantId','quantity'],'INVALID_ORDER_ITEM');if(!uuid(item.variantId)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>20)fail('INVALID_ORDER_ITEM');return {variantId:item.variantId.toLowerCase(),quantity:item.quantity};}).sort((a,b)=>a.variantId.localeCompare(b.variantId));
  if(new Set(items.map(item=>item.variantId)).size!==items.length||items.reduce((sum,item)=>sum+item.quantity,0)>40)fail('INVALID_ORDER_ITEMS');
  if(input.consent!==true)fail('CONSENT_REQUIRED');
  const requestKey=input.requestKey;if(typeof requestKey!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(requestKey))fail('INVALID_REQUEST_KEY');
  const guestAccessToken=input.guestAccessToken;if(typeof guestAccessToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(guestAccessToken))fail('INVALID_GUEST_ACCESS_TOKEN');
  return {customerName,customerEmail,customerMobile,fulfillmentMode:input.fulfillmentMode,branchSlug,deliveryAddress,paymentMethod,items,requestKey:requestKey.toLowerCase(),guestAccessToken};
}
async function checkout(db,tenantId,input){
  const data=cleanCheckout(input),requestKeyHash=digest(data.requestKey),payloadHash=digest(JSON.stringify({...data,requestKey:undefined}));
  await entitlement(db,tenantId);
  // InnoDB may deadlock concurrent requests on absent idempotency-key gaps.
  // Checkout has no external side effects, so retry the rolled-back transaction
  // a bounded number of times and re-evaluate stock/idempotency from current DB state.
  for(let attempt=0;attempt<3;attempt++){
   await db.beginTransaction();try{
    const [[existing]]=await db.query('SELECT id,order_reference AS orderReference,payload_hash AS payloadHash,status,payment_status AS paymentStatus FROM sx_retail_orders WHERE tenant_id=? AND request_key_hash=? FOR UPDATE',[tenantId,requestKeyHash]);
    if(existing){if(existing.payloadHash!==payloadHash)fail('ORDER_REQUEST_REPLAY_CONFLICT',409);await db.commit();return {orderId:existing.id,orderReference:existing.orderReference,guestAccessToken:data.guestAccessToken,status:existing.status,paymentStatus:existing.paymentStatus,repeated:true};}
    const [[branch]]=await db.query("SELECT id,fulfillment_modes AS fulfillmentModes FROM sx_tenant_branches WHERE tenant_id=? AND slug=? AND status='active' AND public_enabled=1 FOR UPDATE",[tenantId,data.branchSlug]);
    if(!branch)fail('RETAIL_BRANCH_UNAVAILABLE',409);
    const modes=typeof branch.fulfillmentModes==='string'?JSON.parse(branch.fulfillmentModes):branch.fulfillmentModes;
    if(!Array.isArray(modes)||!modes.includes(data.fulfillmentMode))fail('FULFILLMENT_UNAVAILABLE',409);
    const lines=[];let currency=null,subtotal=0;
    for(const item of data.items){
      const [[row]]=await db.query(`SELECT v.id AS variantId,v.sku,v.name_en AS nameEn,v.name_ar AS nameAr,v.price_minor AS priceMinor,v.currency,
          s.id AS stockId,s.on_hand AS onHand,s.reserved
        FROM sx_retail_variants v JOIN sx_product_catalog p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
        JOIN sx_retail_stock s ON s.tenant_id=v.tenant_id AND s.variant_id=v.id AND s.branch_id=?
        WHERE v.tenant_id=? AND v.id=? AND v.status='active' AND p.status='active' AND p.deleted_at IS NULL FOR UPDATE`,[branch.id,tenantId,item.variantId]);
      if(!row)fail('RETAIL_ITEM_UNAVAILABLE',409);
      const available=Number(row.onHand)-Number(row.reserved);if(available<item.quantity)fail('RETAIL_STOCK_UNAVAILABLE',409);
      if(currency&&currency!==row.currency)fail('MIXED_CURRENCY_CART',409);currency=row.currency;
      const price=Number(row.priceMinor),lineTotal=price*item.quantity;if(!money(price)||!money(lineTotal)||subtotal+lineTotal>999999999999)fail('INVALID_RETAIL_PRICE');subtotal+=lineTotal;
      lines.push({...item,row,price,lineTotal});
    }
    const id=crypto.randomUUID(),orderReference=`R-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,guestAccessToken=data.guestAccessToken,guestAccessHash=digest(guestAccessToken),paymentStatus=data.paymentMethod==='bank_transfer'?'pending_verification':'unpaid';
    await db.query(`INSERT INTO sx_retail_orders(id,tenant_id,branch_id,order_reference,request_key_hash,payload_hash,guest_access_hash,customer_name,customer_email,customer_mobile,fulfillment_mode,delivery_address,payment_method,payment_status,currency,subtotal_minor,status,consented_at,consent_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',UTC_TIMESTAMP(3),'retail-checkout-v1')`,[id,tenantId,branch.id,orderReference,requestKeyHash,payloadHash,guestAccessHash,data.customerName,data.customerEmail,data.customerMobile,data.fulfillmentMode,data.deliveryAddress,data.paymentMethod,paymentStatus,currency,subtotal]);
    for(const line of lines){
      const [reserved]=await db.query(`UPDATE sx_retail_stock SET reserved=reserved+?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND variant_id=? AND branch_id=? AND on_hand-reserved>=?`,[line.quantity,tenantId,line.variantId,branch.id,line.quantity]);
      if(reserved.affectedRows!==1)fail('RETAIL_STOCK_LEDGER_INVALID',409);
      await db.query(`INSERT INTO sx_retail_order_items(id,tenant_id,order_id,variant_id,sku_snapshot,name_en_snapshot,name_ar_snapshot,quantity,unit_price_minor,currency,line_total_minor)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[crypto.randomUUID(),tenantId,id,line.variantId,line.row.sku,line.row.nameEn,line.row.nameAr,line.quantity,line.price,line.row.currency,line.lineTotal]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'system','retail.order-placed','retail-order',?,?,?)`,[crypto.randomUUID(),tenantId,id,JSON.stringify({orderReference,branchId:branch.id,itemCount:lines.length,subtotalMinor:subtotal,currency,paymentStatus}),crypto.randomUUID()]);
    await db.commit();return {orderId:id,orderReference,guestAccessToken,status:'confirmed',paymentStatus,currency,subtotalMinor:subtotal,repeated:false};
   }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('ORDER_REQUEST_REPLAY_CONFLICT',409);if(error.code==='ER_LOCK_DEADLOCK'&&attempt<2)continue;throw error;}
  }
  fail('RETAIL_CHECKOUT_RETRY_EXHAUSTED',503);
}
async function listOrders(db,ctx,query={}){
  const scope=authorize(ctx,'orders.read'),page=Math.max(1,Math.min(10000,Number.parseInt(query.page,10)||1)),limit=Math.max(1,Math.min(50,Number.parseInt(query.limit,10)||25));
  const where=['o.tenant_id=?'],params=[ctx.tenant.id];if(scope==='assigned'){where.push('b.routing_membership_id=?');params.push(ctx.membership.id);}
  const [rows]=await db.query(`SELECT o.id,o.order_reference AS orderReference,o.customer_name AS customerName,o.customer_email AS customerEmail,o.customer_mobile AS customerMobile,
      o.fulfillment_mode AS fulfillmentMode,o.delivery_address AS deliveryAddress,o.payment_method AS paymentMethod,o.payment_status AS paymentStatus,o.currency,o.subtotal_minor AS subtotalMinor,o.status,o.return_reason AS returnReason,o.revision,o.created_at AS createdAt,b.name_en AS branchNameEn,b.name_ar AS branchNameAr
    FROM sx_retail_orders o JOIN sx_tenant_branches b ON b.tenant_id=o.tenant_id AND b.id=o.branch_id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC,o.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  const items=rows.map(row=>({...row,subtotalMinor:Number(row.subtotalMinor),revision:Number(row.revision)}));
  if(items.length){const ids=items.map(item=>item.id);const [lines]=await db.query(`SELECT order_id AS orderId,sku_snapshot AS sku,name_en_snapshot AS nameEn,name_ar_snapshot AS nameAr,quantity,unit_price_minor AS unitPriceMinor,currency,line_total_minor AS lineTotalMinor FROM sx_retail_order_items WHERE tenant_id=? AND order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY order_id,id`,[ctx.tenant.id,...ids]);for(const item of items)item.items=lines.filter(line=>line.orderId===item.id).map(line=>({...line,quantity:Number(line.quantity),unitPriceMinor:Number(line.unitPriceMinor),lineTotalMinor:Number(line.lineTotalMinor)}));}
  return {items,page,limit};
}
async function updateOrder(db,ctx,id,input){
  const scope=authorize(ctx,'orders.fulfill');if(!uuid(id))fail('INVALID_ORDER_ID');allowed(input,['expectedRevision','status','returnReason'],'INVALID_ORDER_UPDATE');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('INVALID_REVISION');
  const status=input.status;if(!['preparing','ready','out_for_delivery','completed','cancelled','returned'].includes(status))fail('INVALID_ORDER_STATUS');
  const returnReason=Object.hasOwn(input,'returnReason')?text(input.returnReason,1000,'INVALID_RETURN_REASON'):'';
  if(status==='returned'&&!returnReason)fail('INVALID_RETURN_REASON');
  await db.beginTransaction();try{
    const [[order]]=await db.query(`SELECT o.status,o.revision,o.fulfillment_mode AS fulfillmentMode,o.branch_id AS branchId,b.routing_membership_id AS routeMembershipId
      FROM sx_retail_orders o JOIN sx_tenant_branches b ON b.tenant_id=o.tenant_id AND b.id=o.branch_id WHERE o.tenant_id=? AND o.id=? FOR UPDATE`,[ctx.tenant.id,id]);
    if(!order)fail('RETAIL_ORDER_NOT_FOUND',404);if(scope==='assigned'&&order.routeMembershipId!==ctx.membership.id)fail('PERMISSION_DENIED',403);
    if(Number(order.revision)!==input.expectedRevision)fail('STALE_REVISION',409);
    const transitions={confirmed:['preparing','cancelled'],preparing:['ready','out_for_delivery','cancelled'],ready:order.fulfillmentMode==='pickup'?['completed','cancelled']:['out_for_delivery','cancelled'],out_for_delivery:['completed'],return_requested:['returned'],completed:['return_requested']};
    if(!transitions[order.status]?.includes(status))fail('INVALID_ORDER_TRANSITION',409);
    if(['cancelled','completed','returned'].includes(status)){
      const [lines]=await db.query('SELECT variant_id AS variantId,quantity FROM sx_retail_order_items WHERE tenant_id=? AND order_id=? ORDER BY variant_id FOR UPDATE',[ctx.tenant.id,id]);
      for(const line of lines){
        const quantity=Number(line.quantity);
        const [updated]=status==='cancelled'
          ?await db.query(`UPDATE sx_retail_stock SET reserved=reserved-?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND variant_id=? AND branch_id=? AND reserved>=?`,[quantity,ctx.tenant.id,line.variantId,order.branchId,quantity])
          :status==='completed'
            ?await db.query(`UPDATE sx_retail_stock SET reserved=reserved-?,on_hand=on_hand-?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND variant_id=? AND branch_id=? AND reserved>=? AND on_hand>=?`,[quantity,quantity,ctx.tenant.id,line.variantId,order.branchId,quantity,quantity])
            :await db.query(`UPDATE sx_retail_stock SET on_hand=on_hand+?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND variant_id=? AND branch_id=?`,[quantity,ctx.tenant.id,line.variantId,order.branchId]);
        if(updated.affectedRows!==1)fail('RETAIL_STOCK_LEDGER_INVALID',409);
      }
    }
    const [changed]=await db.query('UPDATE sx_retail_orders SET status=?,return_reason=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND revision=?',[status,returnReason||null,ctx.tenant.id,id,input.expectedRevision]);if(changed.affectedRows!==1)fail('STALE_REVISION',409);
    await audit(db,ctx,'retail.order-status-updated','retail-order',id,{from:order.status,to:status,revision:input.expectedRevision+1});await db.commit();return {id,status,revision:input.expectedRevision+1};
  }catch(error){await db.rollback();throw error;}
}
async function requestReturn(db,tenantId,input){
  allowed(input,['orderReference','guestAccessToken','reason'],'INVALID_RETURN_REQUEST');
  const reference=text(input.orderReference,24,'INVALID_ORDER_REFERENCE'),token=typeof input.guestAccessToken==='string'?input.guestAccessToken:'';
  if(!/^R-[A-F0-9]{10}$/.test(reference)||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('RETURN_ACCESS_INVALID',404);
  const reason=text(input.reason,1000,'INVALID_RETURN_REASON');
  await db.beginTransaction();try{
    const [[row]]=await db.query('SELECT id,status,revision FROM sx_retail_orders WHERE tenant_id=? AND order_reference=? AND guest_access_hash=? FOR UPDATE',[tenantId,reference,digest(token)]);
    if(!row)fail('RETURN_ACCESS_INVALID',404);
    if(row.status==='return_requested'){await db.commit();return {orderReference:reference,status:'return_requested',repeated:true};}
    if(row.status!=='completed')fail('RETURN_NOT_AVAILABLE',409);
    const [changed]=await db.query(`UPDATE sx_retail_orders SET status='return_requested',return_reason=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND id=? AND revision=? AND status='completed'`,[reason,tenantId,row.id,row.revision]);
    if(changed.affectedRows!==1)fail('STALE_REVISION',409);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'system','retail.return-requested','retail-order',?,?,?)`,[crypto.randomUUID(),tenantId,row.id,JSON.stringify({orderReference:reference,reason,revision:Number(row.revision)+1}),crypto.randomUUID()]);
    await db.commit();return {orderReference:reference,status:'return_requested',repeated:false};
  }catch(error){await db.rollback();throw error;}
}
module.exports={authorize,entitlement,listVariants,createVariant,updateVariant,setStock,publicCatalog,cleanCheckout,checkout,listOrders,updateOrder,requestReturn};
