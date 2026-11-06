'use strict';
const express = require('express');
const path = require('node:path');
const commerce = require('./retail-commerce');
const {decision} = require('./policy');
const originCheck = require('./request-origin');

const handle = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
const noStore = (req,res,next) => { res.set('Cache-Control','private, no-store'); next(); };
function errors(error,req,res,next) {
  if (res.headersSent) return next(error);
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({success:false,code:'STORE_SLUG_TAKEN'});
  if (error.status >= 400 && error.status < 500) return res.status(error.status).json({success:false,code:error.code || 'INVALID_INPUT'});
  return next(error);
}
const reply = (res,data) => res.json({success:true,data});
function publicRouter({pool,origin}) {
  const router = express.Router({mergeParams:true});
  const throttle = new Map();
  router.use(noStore);
  router.get('/',(req,res) => {
    res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.sendFile(path.resolve(__dirname,'../../client/public/retail-shop.html'));
  });
  router.get('/catalog',handle(async(req,res) => reply(res,await commerce.browse(pool,req.params.storeSlug))));
  let imageJobs=0;
  router.get('/image/:productId/:photoId',handle(async(req,res)=>{
    const {productId,photoId}=req.params;
    if(!commerce.uuid.test(productId)||!commerce.uuid.test(photoId)) return res.sendStatus(404);
    if(imageJobs>=4) return res.sendStatus(503);
    const store=await commerce.getStore(pool,req.params.storeSlug);
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
  router.post('/checkout',(req,res,next) => {
    if (!originCheck.matches(req,origin)) return res.sendStatus(403);
    const now=Date.now();
    for (const [key,row] of throttle) if (row.until<=now) throttle.delete(key);
    const key=req.ip;
    if ((!throttle.has(key) && throttle.size>=5000) || (throttle.get(key)?.count || 0)>=15) return res.sendStatus(429);
    const row=throttle.get(key) || {count:0,until:now+60000};
    row.count++; throttle.set(key,row);
    next();
  },express.json({limit:'12kb'}),handle(async(req,res) => reply(res,await commerce.checkout(pool,req.params.storeSlug,req.body))));
  router.post('/track',(req,res,next)=>originCheck.matches(req,origin)?next():res.sendStatus(403),
    express.json({limit:'1kb'}),handle(async(req,res)=>{
      const reference=req.body?.reference;
      if(typeof reference!=='string'||!commerce.uuid.test(reference))return res.sendStatus(404);
      const store=await commerce.getStore(pool,req.params.storeSlug);
      const [[order]]=await pool.query('SELECT status FROM sx_retail_orders WHERE tenant_id=? AND id=?',[store.tenantId,reference]);
      if(!order)return res.sendStatus(404);
      reply(res,order);
    }));
  router.use(errors);
  return router;
}
function workspaceRouter({pool,authenticate}) {
  const router=express.Router();
  router.use(noStore,authenticate,express.json({limit:'12kb'}));
  const allow=(permission,fn)=>handle(async(req,res)=>{
    const context=req.businessContext;
    if (!decision(context,{capability:'retail.commerce',permission}).allowed) return res.sendStatus(403);
    return fn(req,res,context);
  });
  router.get('/store',allow('retail.configure',async(req,res,c)=>{
    const [[store]]=await pool.query('SELECT slug,title,about,contact,enabled,delivery_fee AS deliveryFee,delivery_zones AS deliveryZones FROM sx_retail_store WHERE tenant_id=?',[c.tenant.id]);
    const [products]=await pool.query(`SELECT p.id,p.code,p.name_en AS nameEn,p.name_ar AS nameAr,p.status,l.category,l.published,l.photo_id AS photoId
      FROM sx_product_catalog p LEFT JOIN sx_retail_listings l ON l.tenant_id=p.tenant_id AND l.product_id=p.id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status<>'retired' ORDER BY p.code LIMIT 500`,[c.tenant.id]);
    const [photos]=await pool.query(`SELECT id,course_id AS productId,original_name AS name FROM sx_product_media
      WHERE tenant_id=? AND deleted_at IS NULL AND mime_type IN ('image/jpeg','image/png','image/webp') ORDER BY created_at DESC LIMIT 2000`,[c.tenant.id]);
    reply(res,{store:store&&{...store,deliveryZones:typeof store.deliveryZones==='string'?JSON.parse(store.deliveryZones):store.deliveryZones||[]},products,photos});
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
  async function list(res,c,driver) {
    const [rows]=await pool.query(`SELECT id,buyer_name AS buyerName,buyer_phone AS buyerPhone,delivery_address AS deliveryAddress,delivery_pin AS deliveryPin,delivery_zone AS deliveryZone,
      fulfillment,order_lines AS orderLines,total_minor AS totalMinor,status,lead_id AS leadId,cash_received_at AS cashReceivedAt,driver_id AS driverId,created_at AS createdAt
      FROM sx_retail_orders WHERE tenant_id=? ${driver ? "AND driver_id=? AND status IN ('ready','dispatched')" : ''} ORDER BY created_at DESC LIMIT 100`,
      driver?[c.tenant.id,c.membership.id]:[c.tenant.id]);
    reply(res,rows.map(({orderLines,...row})=>({...row,lines:typeof orderLines==='string'?JSON.parse(orderLines):orderLines})));
  }
  router.get('/orders',allow('retail.orders',(req,res,c)=>list(res,c,false)));
  router.get('/deliveries',allow('retail.deliver',(req,res,c)=>list(res,c,true)));
  router.get('/drivers',allow('retail.orders',async(req,res,c)=>{
    const [rows]=await pool.query(`SELECT m.id,i.display_name AS name FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      WHERE m.tenant_id=? AND m.status='active' AND m.role='agent' AND i.status='active' ORDER BY i.display_name LIMIT 200`,[c.tenant.id]);
    reply(res,rows);
  }));
  router.put('/orders/:id/driver',allow('retail.orders',async(req,res,c)=>{
    const id=req.params.id, driver=req.body?.driverId;
    if (!commerce.uuid.test(id)||!commerce.uuid.test(driver || '')) commerce.fail('INVALID_ASSIGNMENT');
    const [result]=await pool.query(`UPDATE sx_retail_orders o JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=?
      JOIN sx_identities i ON i.id=m.identity_id SET o.driver_id=m.id WHERE o.tenant_id=? AND o.id=? AND o.fulfillment='delivery'
      AND o.status IN ('placed','ready') AND m.status='active' AND m.role='agent' AND i.status='active'`,[driver,c.tenant.id,id]);
    if (!result.affectedRows) commerce.fail('ASSIGNMENT_UNAVAILABLE',409);
    reply(res,{driverId:driver});
  }));
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
  router.post('/orders/:id/cash-received',allow('retail.orders',async(req,res,c)=>{
    const id=req.params.id;
    if(!commerce.uuid.test(id))commerce.fail('ORDER_NOT_FOUND',404);
    const [result]=await pool.query(`UPDATE sx_retail_orders SET cash_received_by=IF(cash_received_at IS NULL,?,cash_received_by),
      cash_received_at=COALESCE(cash_received_at,UTC_TIMESTAMP(3)) WHERE tenant_id=? AND id=? AND status='completed'`,
      [c.identity.id,c.tenant.id,id]);
    if(!result.affectedRows){
      const [[record]]=await pool.query("SELECT cash_received_at AS received FROM sx_retail_orders WHERE tenant_id=? AND id=? AND status='completed'",
        [c.tenant.id,id]);
      if(!record?.received)commerce.fail('CASH_RECORD_UNAVAILABLE',409);
    }
    reply(res,{received:true});
  }));
  for (const [url,permission,driver] of [['/orders','retail.orders',false],['/deliveries','retail.deliver',true]]) {
    router.post(url+'/:id/status',allow(permission,async(req,res,c)=>reply(res,
      await commerce.transition(pool,c.tenant.id,{identityId:c.identity.id,membershipId:c.membership.id},req.params.id,req.body?.status,driver))));
  }
  router.use(errors);
  return router;
}
module.exports={publicRouter,workspaceRouter};
