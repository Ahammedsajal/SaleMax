'use strict';
const express = require('express');
const path = require('node:path');
const {randomUUID}=require('node:crypto');
const commerce = require('./retail-commerce');
const {decision} = require('./policy');
const originCheck = require('./request-origin');

const handle = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
const noStore = (req,res,next) => { res.set('Cache-Control','private, no-store'); next(); };
function errors(error,req,res,next) {
  if (res.headersSent) return next(error);
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({success:false,code:'CONFLICT'});
  if (error.status >= 400 && error.status < 500) return res.status(error.status).json({success:false,code:error.code || 'INVALID_INPUT'});
  return next(error);
}
const reply = (res,data) => res.json({success:true,data});
function publicRouter({pool,origin}) {
  const router = express.Router({mergeParams:true});
  const throttle = new Map();
  const storeForRequest=(db,req)=>req.crmTenantDomain?
    commerce.getStoreForTenant(db,req.crmTenantDomain.tenantId):commerce.getStore(db,req.params.storeSlug);
  const publicPostGuard=(req,res,next)=>{
    if(!originCheck.matches(req,origin))return res.sendStatus(403);
    const now=Date.now();
    for(const [key,row] of throttle)if(row.until<=now)throttle.delete(key);
    const key=req.ip;
    if((!throttle.has(key)&&throttle.size>=5000)||(throttle.get(key)?.count||0)>=15)return res.sendStatus(429);
    const row=throttle.get(key)||{count:0,until:now+60000};row.count++;throttle.set(key,row);next();
  };
  router.use((req,res,next)=>{
    if(!req.crmTenantDomain&&!req.params.storeSlug)return next('router');
    return noStore(req,res,next);
  });
  router.get('/',(req,res,next)=>{
    storeForRequest(pool,req).then(()=>{
      res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      if(!req.crmTenantDomain){
        const requested=new URL(req.originalUrl,'https://7network.live');
        if(!requested.pathname.endsWith('/')){
          requested.pathname+='/';
          return res.redirect(308,requested.pathname+requested.search);
        }
      }
      res.sendFile(path.resolve(__dirname,'../../client/public/retail-shop.html'));
    }).catch(error=>{
      if(req.crmTenantDomain&&error.code==='STORE_NOT_FOUND')return next('router');
      return next(error);
    });
  });
  router.get('/manifest.webmanifest',handle(async(req,res)=>{
    const store=await storeForRequest(pool,req),scope=req.crmTenantDomain?'/':`/business/${encodeURIComponent(store.slug)}/shop/`;
    res.set('Cache-Control','private, no-store');
    res.type('application/manifest+json').json({id:scope,start_url:scope,scope,display:'standalone',name:store.title,short_name:store.title.slice(0,24),
      description:store.about||store.title,background_color:'#081630',theme_color:'#081630',lang:'en',dir:'auto',
      icons:[{src:'/branding/7network/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/branding/7network/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'}]});
  }));
  router.get('/service-worker.js',handle(async(req,res)=>{
    await storeForRequest(pool,req);
    res.set('Cache-Control','no-store');
    res.set('Service-Worker-Allowed',req.crmTenantDomain?'/':`/business/${encodeURIComponent(req.params.storeSlug)}/shop/`);
    res.type('application/javascript').sendFile(path.resolve(__dirname,'../../client/public/retail-shop-sw.js'));
  }));
  router.get('/catalog',handle(async(req,res) => {
    const locationId=typeof req.query.locationId==='string'?req.query.locationId:null;
    if(!req.crmTenantDomain)return reply(res,await commerce.browse(pool,req.params.storeSlug,locationId));
    const {tenantId,...store}=await storeForRequest(pool,req);
    reply(res,await commerce.browseTenant(pool,tenantId,store,locationId));
  }));
  let imageJobs=0;
  router.get('/image/:productId/:photoId',handle(async(req,res)=>{
    const {productId,photoId}=req.params;
    if(!commerce.uuid.test(productId)||!commerce.uuid.test(photoId)) return res.sendStatus(404);
    if(imageJobs>=4) return res.sendStatus(503);
    const store=await storeForRequest(pool,req);
    const [[photo]]=await pool.query(`SELECT m.storage_key AS storageKey FROM sx_product_media m
      JOIN sx_retail_listings l ON l.tenant_id=m.tenant_id AND l.product_id=m.course_id AND l.photo_id=m.id
      JOIN sx_product_catalog p ON p.tenant_id=l.tenant_id AND p.id=l.product_id
      WHERE m.tenant_id=? AND m.course_id=? AND m.id=? AND m.deleted_at IS NULL
      AND m.mime_type IN ('image/jpeg','image/png','image/webp') AND p.status='active' AND p.deleted_at IS NULL AND l.published=1`,
      [store.tenantId,productId,photoId]);
    if(!photo) return res.sendStatus(404);
    if(imageJobs>=4) return res.sendStatus(503);
    imageJobs++;
    try {
      const file=require('./training-course-media').filePath(store.tenantId,productId,photo.storageKey);
      const image=await require('sharp')(file,{limitInputPixels:16000000}).rotate().resize({width:800,height:800,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
      res.set('X-Content-Type-Options','nosniff').type('image/webp').send(image);
    } catch {res.sendStatus(404);} finally {imageJobs--;}
  }));
  router.post('/checkout/recover',publicPostGuard,express.json({limit:'1kb'}),handle(async(req,res)=>{
    const requestId=req.body?.requestId;
    if(typeof requestId!=='string')commerce.fail('CHECKOUT_NOT_FOUND',404);
    if(!req.crmTenantDomain)return reply(res,await commerce.recoverCheckout(pool,req.params.storeSlug,requestId));
    const store=await storeForRequest(pool,req);
    return reply(res,await commerce.recoverCheckout(pool,store.slug,requestId));
  }));
  router.post('/checkout',publicPostGuard,express.json({limit:'12kb'}),handle(async(req,res) => {
    if(!req.crmTenantDomain)return reply(res,await commerce.checkout(pool,req.params.storeSlug,req.body));
    const store=await storeForRequest(pool,req);
    return reply(res,await commerce.checkout(pool,store.slug,req.body));
  }));
  router.post('/track',publicPostGuard,
    express.json({limit:'1kb'}),handle(async(req,res)=>{
      const reference=req.body?.reference;
      if(typeof reference!=='string'||!commerce.uuid.test(reference))return res.sendStatus(404);
      const store=await storeForRequest(pool,req);
      const [[order]]=await pool.query('SELECT status,delivery_state AS deliveryState FROM sx_retail_orders WHERE tenant_id=? AND id=?',[store.tenantId,reference]);
      if(!order)return res.sendStatus(404);
      reply(res,order);
    }));
  router.use(errors);
  return router;
}
function workspaceRouter({pool,authenticate}) {
  const router=express.Router();
  router.use(noStore,authenticate,express.json({limit:'12kb'}));
  const allow=(permission,fn,capability='retail.commerce')=>handle(async(req,res)=>{
    const context=req.businessContext;
    if (!decision(context,{capability,permission}).allowed) return res.sendStatus(403);
    return fn(req,res,context);
  });
  router.get('/store',allow('retail.configure',async(req,res,c)=>{
    const [[store]]=await pool.query('SELECT slug,title,about,contact,enabled,delivery_fee AS deliveryFee,delivery_zones AS deliveryZones FROM sx_retail_store WHERE tenant_id=?',[c.tenant.id]);
    const [[notificationSettings]]=await pool.query('SELECT retail_orders_enabled AS retailOrdersEnabled FROM sx_business_notification_settings WHERE tenant_id=?',[c.tenant.id]);
    const [products]=await pool.query(`SELECT p.id,p.code,p.name_en AS nameEn,p.name_ar AS nameAr,p.status,l.category,l.published,l.photo_id AS photoId
      FROM sx_product_catalog p LEFT JOIN sx_retail_listings l ON l.tenant_id=p.tenant_id AND l.product_id=p.id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status<>'retired' ORDER BY p.code LIMIT 500`,[c.tenant.id]);
    const [photos]=await pool.query(`SELECT id,course_id AS productId,original_name AS name FROM sx_product_media
      WHERE tenant_id=? AND deleted_at IS NULL AND mime_type IN ('image/jpeg','image/png','image/webp') ORDER BY created_at DESC LIMIT 2000`,[c.tenant.id]);
    const [locations]=await pool.query(`SELECT id,code,name_en AS nameEn,name_ar AS nameAr,address,map_pin AS mapPin,
      accepts_pickup AS acceptsPickup,accepts_delivery AS acceptsDelivery,is_default AS isDefault,status
      FROM sx_retail_locations WHERE tenant_id=? ORDER BY status,is_default DESC,name_en,id`,[c.tenant.id]);
    const [variantRows]=await pool.query(`SELECT g.id,g.title_en AS titleEn,g.title_ar AS titleAr,g.option_label_en AS optionLabelEn,
      g.option_label_ar AS optionLabelAr,vp.product_id AS productId,vp.value_en AS valueEn,vp.value_ar AS valueAr,vp.sort_order AS sortOrder
      FROM sx_retail_variant_groups g LEFT JOIN sx_retail_variant_products vp ON vp.tenant_id=g.tenant_id AND vp.group_id=g.id
      WHERE g.tenant_id=? ORDER BY g.updated_at DESC,g.id,vp.sort_order`,[c.tenant.id]);
    const groups=new Map();for(const row of variantRows){if(!groups.has(row.id))groups.set(row.id,{id:row.id,titleEn:row.titleEn,titleAr:row.titleAr,
      optionLabelEn:row.optionLabelEn,optionLabelAr:row.optionLabelAr,products:[]});if(row.productId)groups.get(row.id).products.push({id:row.productId,valueEn:row.valueEn,valueAr:row.valueAr,sortOrder:Number(row.sortOrder)});}
    reply(res,{store:store&&{...store,deliveryZones:typeof store.deliveryZones==='string'?JSON.parse(store.deliveryZones):store.deliveryZones||[]},products,photos,locations,
      notifications:{retailOrdersEnabled:Boolean(notificationSettings?.retailOrdersEnabled)},variants:[...groups.values()]});
  }));
  router.put('/notifications',allow('retail.configure',async(req,res,c)=>{
    const input=req.body||{};
    if(Object.keys(input).some(key=>key!=='retailOrdersEnabled')||typeof input.retailOrdersEnabled!=='boolean')commerce.fail('INVALID_NOTIFICATION_SETTINGS');
    await pool.query(`INSERT INTO sx_business_notification_settings(tenant_id,retail_orders_enabled) VALUES (?,?)
      ON DUPLICATE KEY UPDATE retail_orders_enabled=VALUES(retail_orders_enabled)`,[c.tenant.id,Number(input.retailOrdersEnabled)]);
    reply(res,{retailOrdersEnabled:input.retailOrdersEnabled});
  }));
  router.put('/store',allow('retail.configure',async(req,res,c)=>{
    const {slug,enabled,deliveryFee,deliveryZones=[]}=req.body || {};
    if (!commerce.slugPattern.test(slug || '') || typeof enabled!=='boolean' ||
      !(deliveryFee===null || (Number.isSafeInteger(deliveryFee) && deliveryFee>=0 && deliveryFee<=1000000))) commerce.fail('INVALID_STORE');
    if(!Array.isArray(deliveryZones)||deliveryZones.length>50)commerce.fail('INVALID_ZONES');
    const zones=deliveryZones.map(zone=>{
      if(!zone||!Number.isSafeInteger(zone.feeMinor)||zone.feeMinor<0||zone.feeMinor>1000000)commerce.fail('INVALID_ZONES');
      return {name:commerce.string(zone.name,100),feeMinor:zone.feeMinor};
    });
    if(new Set(zones.map(zone=>zone.name.toLowerCase())).size!==zones.length)commerce.fail('INVALID_ZONES');
    const title=commerce.string(req.body.title,160);
    const about=commerce.string(req.body.about,4000,false);
    const contact=commerce.string(req.body.contact,200,false);
    await pool.query(`INSERT INTO sx_retail_store (tenant_id,slug,title,about,contact,enabled,delivery_fee,delivery_zones) VALUES (?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE slug=IF(tenant_id=VALUES(tenant_id),VALUES(slug),slug),
      title=IF(tenant_id=VALUES(tenant_id),VALUES(title),title),about=IF(tenant_id=VALUES(tenant_id),VALUES(about),about),
      contact=IF(tenant_id=VALUES(tenant_id),VALUES(contact),contact),enabled=IF(tenant_id=VALUES(tenant_id),VALUES(enabled),enabled),
      delivery_fee=IF(tenant_id=VALUES(tenant_id),VALUES(delivery_fee),delivery_fee),
      delivery_zones=IF(tenant_id=VALUES(tenant_id),VALUES(delivery_zones),delivery_zones)`,[c.tenant.id,slug,title,about,contact,enabled,deliveryFee,JSON.stringify(zones)]);
    const [[saved]]=await pool.query('SELECT slug FROM sx_retail_store WHERE tenant_id=?',[c.tenant.id]);
    if (saved?.slug!==slug) commerce.fail('STORE_SLUG_TAKEN',409);
    reply(res,{slug});
  }));
  router.put('/listings/:id',allow('retail.configure',async(req,res,c)=>{
    const {published,photoId=null}=req.body || {};
    if (!commerce.uuid.test(req.params.id) || typeof published!=='boolean' || (photoId!==null&&!commerce.uuid.test(photoId))) commerce.fail('INVALID_LISTING');
    const category=commerce.string(req.body.category,100,false);
    await commerce.transaction(pool,async db=>{
      await commerce.lockProduct(db,c.tenant.id,req.params.id,true);
      if(photoId){
        const [[photo]]=await db.query(`SELECT id FROM sx_product_media WHERE tenant_id=? AND course_id=? AND id=? AND deleted_at IS NULL
          AND mime_type IN ('image/jpeg','image/png','image/webp')`,[c.tenant.id,req.params.id,photoId]);
        if(!photo)commerce.fail('INVALID_PHOTO');
      }
      await db.query(`INSERT INTO sx_retail_listings (tenant_id,product_id,category,published,photo_id) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE category=VALUES(category),published=VALUES(published),photo_id=VALUES(photo_id)`,[c.tenant.id,req.params.id,category,published,photoId]);
    });
    reply(res,{published});
  }));
  router.post('/variants',allow('retail.configure',async(req,res,c)=>{
    const input=req.body||{},groupId=input.id??null;
    if(Object.keys(input).some(key=>!['id','titleEn','titleAr','optionLabelEn','optionLabelAr','products'].includes(key)))commerce.fail('INVALID_VARIANT_GROUP');
    if(groupId!==null&&!commerce.uuid.test(groupId))commerce.fail('INVALID_VARIANT_GROUP');
    const titleEn=commerce.string(input.titleEn,160),titleAr=commerce.string(input.titleAr||'',160,false),
      optionLabelEn=commerce.string(input.optionLabelEn,80),optionLabelAr=commerce.string(input.optionLabelAr||'',80,false);
    if(!Array.isArray(input.products)||input.products.length<2||input.products.length>50)commerce.fail('INVALID_VARIANTS');
    const products=input.products.map((item,index)=>{
      if(!item||Object.keys(item).some(key=>!['id','valueEn','valueAr'].includes(key))||!commerce.uuid.test(item.id||''))commerce.fail('INVALID_VARIANTS');
      return {id:item.id.toLowerCase(),valueEn:commerce.string(item.valueEn,100),valueAr:commerce.string(item.valueAr||'',100,false),sortOrder:index};
    });
    if(new Set(products.map(item=>item.id)).size!==products.length)commerce.fail('INVALID_VARIANTS');
    if(new Set(products.map(item=>item.valueEn.toLowerCase())).size!==products.length)commerce.fail('INVALID_VARIANTS');
    const normalizedGroupId=groupId?.toLowerCase()||null;
    const result=await commerce.transaction(pool,async db=>{
      await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[c.tenant.id]);
      for(const productId of products.map(item=>item.id).sort())await commerce.lockProduct(db,c.tenant.id,productId,true);
      let id=normalizedGroupId;
      if(id){const [[existing]]=await db.query('SELECT id FROM sx_retail_variant_groups WHERE tenant_id=? AND id=? FOR UPDATE',[c.tenant.id,id]);if(!existing)commerce.fail('VARIANT_GROUP_NOT_FOUND',404);}
      else id=randomUUID();
      const [rows]=await db.query(`SELECT l.product_id AS id,l.category FROM sx_retail_listings l
        JOIN sx_product_catalog p ON p.tenant_id=l.tenant_id AND p.id=l.product_id
        WHERE l.tenant_id=? AND l.published=1 AND p.status='active' AND p.deleted_at IS NULL AND l.product_id IN (?)
          AND EXISTS (SELECT 1 FROM sx_product_offers o WHERE o.tenant_id=p.tenant_id AND o.course_id=p.id AND o.status='active'
            AND o.currency='QAR' AND (o.valid_from IS NULL OR o.valid_from<=CURRENT_DATE) AND (o.valid_until IS NULL OR o.valid_until>=CURRENT_DATE))`,
      [c.tenant.id,products.map(item=>item.id)]);
      if(rows.length!==products.length||new Set(rows.map(row=>row.category)).size!==1)commerce.fail('VARIANT_PRODUCTS_UNAVAILABLE',409);
      const [conflicts]=await db.query(`SELECT product_id FROM sx_retail_variant_products WHERE tenant_id=? AND product_id IN (?) AND group_id<>? FOR UPDATE`,
        [c.tenant.id,products.map(item=>item.id),id]);
      if(conflicts.length)commerce.fail('VARIANT_PRODUCT_ALREADY_GROUPED',409);
      if(normalizedGroupId)await db.query(`UPDATE sx_retail_variant_groups SET title_en=?,title_ar=?,option_label_en=?,option_label_ar=? WHERE tenant_id=? AND id=?`,
        [titleEn,titleAr,optionLabelEn,optionLabelAr,c.tenant.id,id]);
      else await db.query(`INSERT INTO sx_retail_variant_groups (id,tenant_id,title_en,title_ar,option_label_en,option_label_ar,created_by_identity_id)
        VALUES (?,?,?,?,?,?,?)`,[id,c.tenant.id,titleEn,titleAr,optionLabelEn,optionLabelAr,c.identity.id]);
      await db.query('DELETE FROM sx_retail_variant_products WHERE tenant_id=? AND group_id=?',[c.tenant.id,id]);
      for(const item of products)await db.query(`INSERT INTO sx_retail_variant_products (tenant_id,group_id,product_id,value_en,value_ar,sort_order)
        VALUES (?,?,?,?,?,?)`,[c.tenant.id,id,item.id,item.valueEn,item.valueAr,item.sortOrder]);
      return {id,productCount:products.length};
    });
    reply(res,result);
  }));
  router.delete('/variants/:id',allow('retail.configure',async(req,res,c)=>{
    if(!commerce.uuid.test(req.params.id))commerce.fail('VARIANT_GROUP_NOT_FOUND',404);
    await commerce.transaction(pool,async db=>{
      await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[c.tenant.id]);
      const [[group]]=await db.query('SELECT id FROM sx_retail_variant_groups WHERE tenant_id=? AND id=? FOR UPDATE',[c.tenant.id,req.params.id]);
      if(!group)commerce.fail('VARIANT_GROUP_NOT_FOUND',404);
      await db.query('DELETE FROM sx_retail_variant_groups WHERE tenant_id=? AND id=?',[c.tenant.id,req.params.id]);
    });
    reply(res,{deleted:true});
  }));
  async function list(res,c,driver) {
    const [rows]=await pool.query(`SELECT o.id,o.buyer_name AS buyerName,o.buyer_phone AS buyerPhone,o.delivery_address AS deliveryAddress,o.delivery_pin AS deliveryPin,o.delivery_zone AS deliveryZone,
      l.name_en AS locationNameEn,l.name_ar AS locationNameAr,o.fulfillment,o.order_lines AS orderLines,o.total_minor AS totalMinor,o.status,o.delivery_state AS deliveryState,
      o.delivery_proof_required AS proofRequired,o.lead_id AS leadId,o.cash_received_at AS cashReceivedAt,o.driver_id AS driverId,o.created_at AS createdAt
      FROM sx_retail_orders o LEFT JOIN sx_retail_locations l ON l.tenant_id=o.tenant_id AND l.id=o.location_id
      WHERE o.tenant_id=? ${driver ? "AND o.driver_id=? AND o.status IN ('ready','dispatched')" : ''} ORDER BY o.created_at DESC LIMIT 100`,
      driver?[c.tenant.id,c.membership.id]:[c.tenant.id]);
    const ids=rows.map(row=>row.id);
    const returned=ids.length?(await pool.query('SELECT order_id AS orderId,product_id AS productId,SUM(quantity) AS quantity FROM sx_retail_return_lines WHERE tenant_id=? AND order_id IN (?) GROUP BY order_id,product_id',[c.tenant.id,ids]))[0]:[];
    const receipts=ids.length?(await pool.query('SELECT order_id AS orderId FROM sx_retail_cash_receipts WHERE tenant_id=? AND order_id IN (?)',[c.tenant.id,ids]))[0]:[];
    const proofs=ids.length?(await pool.query('SELECT order_id AS orderId,verified_at AS verifiedAt FROM sx_retail_delivery_proofs WHERE tenant_id=? AND order_id IN (?)',[c.tenant.id,ids]))[0]:[];
    const attempts=ids.length?(await pool.query(`SELECT order_id AS orderId,result,reason,attempt_number AS attemptNumber,created_at AS createdAt
      FROM sx_retail_delivery_attempts WHERE tenant_id=? AND order_id IN (?) ORDER BY created_at DESC,id DESC`,[c.tenant.id,ids]))[0]:[];
    const returnedByOrder=new Map();
    for(const line of returned){if(!returnedByOrder.has(line.orderId))returnedByOrder.set(line.orderId,new Map());returnedByOrder.get(line.orderId).set(line.productId,Number(line.quantity));}
    const received=new Set(receipts.map(row=>row.orderId));
    const proofByOrder=new Map(proofs.map(row=>[row.orderId,row]));
    const attemptByOrder=new Map(),failureCountByOrder=new Map();
    for(const attempt of attempts){
      if(attempt.result==='failed')failureCountByOrder.set(attempt.orderId,(failureCountByOrder.get(attempt.orderId)||0)+1);
      if(!attemptByOrder.has(attempt.orderId))attemptByOrder.set(attempt.orderId,attempt);
    }
    reply(res,rows.map(({orderLines,proofRequired,...row})=>{
      const prior=returnedByOrder.get(row.id)||new Map();
      const lines=(typeof orderLines==='string'?JSON.parse(orderLines):orderLines).map(line=>({
        ...line,returnedQuantity:prior.get(line.id)||0,returnableQuantity:Number(line.quantity)-(prior.get(line.id)||0)
      }));
      const proof=proofByOrder.get(row.id),latestAttempt=attemptByOrder.get(row.id);
      return {...row,totalMinor:Number(row.totalMinor),cashReceived:Boolean(row.cashReceivedAt)||received.has(row.id),
        deliveryProofRequired:Boolean(proofRequired),proofVerified:Boolean(proof?.verifiedAt),deliveryAttemptCount:failureCountByOrder.get(row.id)||0,
        lastDeliveryResult:latestAttempt?.result||null,lastDeliveryFailureReason:latestAttempt?.result==='failed'?latestAttempt.reason:null,lines};
    }));
  }
  router.get('/orders',allow('retail.orders',(req,res,c)=>list(res,c,false)));
  router.get('/deliveries',allow('retail.deliver',(req,res,c)=>list(res,c,true)));
  router.get('/drivers',allow('retail.orders',async(req,res,c)=>{
    const [rows]=await pool.query(`SELECT m.id,i.display_name AS name FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      WHERE m.tenant_id=? AND m.status='active' AND m.role='agent' AND i.status='active' ORDER BY i.display_name LIMIT 200`,[c.tenant.id]);
    reply(res,rows);
  }));
  router.get('/finance',allow('retail.finance',async(req,res,c)=>{
    const [receipts]=await pool.query(`SELECT r.collector_membership_id AS driverId,i.display_name AS driverName,o.id AS orderId,r.amount_minor AS amountMinor,r.received_at AS receivedAt,
      COUNT(*) OVER(PARTITION BY r.collector_membership_id) AS orderCount
      FROM sx_retail_cash_receipts r JOIN sx_retail_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id
      JOIN sx_memberships m ON m.tenant_id=r.tenant_id AND m.id=r.collector_membership_id
      JOIN sx_identities i ON i.id=m.identity_id WHERE r.tenant_id=? AND r.settlement_id IS NULL AND o.fulfillment='delivery'
      ORDER BY i.display_name,r.received_at,o.id LIMIT 1000`,[c.tenant.id]);
    const drivers=new Map();
    for(const row of receipts){
      if(!drivers.has(row.driverId))drivers.set(row.driverId,{id:row.driverId,name:row.driverName,orders:[],expectedMinor:0});
      const driver=drivers.get(row.driverId);driver.orders.push({id:row.orderId,amountMinor:Number(row.amountMinor),receivedAt:row.receivedAt});driver.expectedMinor+=Number(row.amountMinor);driver.orderCount=Number(row.orderCount);
    }
    for(const driver of drivers.values())driver.hasMore=driver.orderCount>driver.orders.length;
    const [settlements]=await pool.query(`SELECT s.id,s.driver_membership_id AS driverId,i.display_name AS driverName,s.expected_minor AS expectedMinor,
      s.counted_minor AS countedMinor,s.status,s.created_at AS createdAt FROM sx_retail_cash_settlements s
      JOIN sx_memberships m ON m.tenant_id=s.tenant_id AND m.id=s.driver_membership_id JOIN sx_identities i ON i.id=m.identity_id
      WHERE s.tenant_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 30`,[c.tenant.id]);
    reply(res,{drivers:[...drivers.values()],settlements:settlements.map(row=>({...row,expectedMinor:Number(row.expectedMinor),countedMinor:Number(row.countedMinor)}))});
  },'retail.finance'));
  router.post('/finance/settlements',allow('retail.finance',async(req,res,c)=>reply(res,
    await commerce.recordSettlement(pool,c.tenant.id,{identityId:c.identity.id},req.body)), 'retail.finance'));
  router.put('/orders/:id/driver',allow('retail.orders',async(req,res,c)=>{
    const id=req.params.id, driver=req.body?.driverId;
    if (!commerce.uuid.test(id)||!commerce.uuid.test(driver || '')) commerce.fail('INVALID_ASSIGNMENT');
    reply(res,await commerce.assignDriver(pool,c.tenant.id,{identityId:c.identity.id},id,driver));
  }));
  router.post('/deliveries/:id/failed',allow('retail.deliver',async(req,res,c)=>reply(res,
    await commerce.reportDeliveryFailure(pool,c.tenant.id,{identityId:c.identity.id,membershipId:c.membership.id},req.params.id,req.body))));
  router.post('/deliveries/:id/retry',allow('retail.deliver',async(req,res,c)=>reply(res,
    await commerce.retryDelivery(pool,c.tenant.id,{identityId:c.identity.id,membershipId:c.membership.id},req.params.id,req.body))));
  router.post('/deliveries/:id/proof',allow('retail.deliver',async(req,res,c)=>reply(res,
    await commerce.verifyDeliveryProof(pool,c.tenant.id,{identityId:c.identity.id,membershipId:c.membership.id},req.params.id,req.body))));
  router.post('/orders/:id/cash-received',allow('retail.cash.collect',async(req,res,c)=>reply(res,
    await commerce.recordCashReceipt(pool,c.tenant.id,{identityId:c.identity.id,membershipId:c.membership.id,role:c.membership.role},req.params.id,req.body,false))));
  router.post('/deliveries/:id/cash-received',allow('retail.deliver',async(req,res,c)=>reply(res,
    await commerce.recordCashReceipt(pool,c.tenant.id,{identityId:c.identity.id,membershipId:c.membership.id,role:c.membership.role},req.params.id,req.body,true))));
  router.post('/orders/:id/returns',allow('retail.returns',async(req,res,c)=>reply(res,
    await commerce.returnItems(pool,c.tenant.id,{identityId:c.identity.id},req.params.id,req.body))));
  router.post('/orders/:id/lead',allow('retail.orders',async(req,res,c)=>{
    const id=req.params.id;
    const uid=req.featureSession?.ownerUid;
    if(c.membership.role!=='owner'||!uid||!decision(c,{capability:'crm.leads',permission:'leads.manage'}).allowed)return res.sendStatus(403);
    if(!commerce.uuid.test(id))commerce.fail('ORDER_NOT_FOUND',404);
    const lead=await commerce.transaction(pool,async db=>{
      const [[order]]=await db.query('SELECT buyer_name AS name,buyer_phone AS phone,lead_id AS leadId FROM sx_retail_orders WHERE tenant_id=? AND id=? FOR UPDATE',[c.tenant.id,id]);
      if(!order)commerce.fail('ORDER_NOT_FOUND',404);
      if(order.leadId)return {id:order.leadId};
      const {createManualLead,normalizePhone}=require('../../helper/pipeline/leadPipeline');
      const result=await createManualLead({uid,actorType:'user',actorId:uid,role:'owner',categoryKey:c.tenant.categoryKey,connection:db,
        input:{title:'Retail order '+id,contactName:order.name,mobile:normalizePhone(order.phone)||undefined,sourceType:'manual'}});
      await db.query('UPDATE sx_retail_orders SET lead_id=? WHERE tenant_id=? AND id=?',[result.id,c.tenant.id,id]);
      return {id:result.id};
    });
    reply(res,lead);
  }));
  for (const [url,permission,driver] of [['/orders','retail.orders',false],['/deliveries','retail.deliver',true]]) {
    router.post(url+'/:id/status',allow(permission,async(req,res,c)=>reply(res,
      await commerce.transition(pool,c.tenant.id,{identityId:c.identity.id,membershipId:c.membership.id},req.params.id,req.body?.status,driver))));
  }
  router.use(errors);
  return router;
}
module.exports={publicRouter,workspaceRouter};
