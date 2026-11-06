'use strict';

const express = require('express');
const { decision } = require('./policy');
const retailProductSync = require('./retail-product-sync');
const { randomUUID } = require('node:crypto');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const validQuantity = value => Number.isInteger(value) && value >= 0 && value <= 1000000000;

module.exports = function createInventoryRouter({pool, authenticate}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  }, authenticate, express.json({limit: '4kb'}));

  function action(permission, handler) {
    return async (req, res, next) => {
      const context = req.businessContext;
      if (!context || !decision(context, {capability: 'retail.inventory', permission, key: 'business-inventory'}).allowed) {
        return res.status(403).json({success: false, code: 'PERMISSION_DENIED'});
      }
      try {
        await handler(req, res, context.tenant.id);
      } catch (error) {
        next(error);
      }
    };
  }

  async function locationFor(db,tenant,requestedId=null,lock=false){
    if(requestedId&&!uuid.test(requestedId))return null;
    const filter=requestedId?'AND id=?':'AND is_default=1';
    const values=requestedId?[tenant,requestedId]:[tenant];
    const [[row]]=await db.query(`SELECT id,code,name_en AS nameEn,name_ar AS nameAr,address,map_pin AS mapPin,
      accepts_pickup AS acceptsPickup,accepts_delivery AS acceptsDelivery,is_default AS isDefault,status
      FROM sx_retail_locations WHERE tenant_id=? AND status='active' ${filter} LIMIT 1${lock?' FOR UPDATE':''}`,values);
    return row||null;
  }

  router.get('/locations', action('inventory.read', async (req, res, tenant) => {
    const [rows]=await pool.query(`SELECT id,code,name_en AS nameEn,name_ar AS nameAr,address,map_pin AS mapPin,
      accepts_pickup AS acceptsPickup,accepts_delivery AS acceptsDelivery,is_default AS isDefault,status
      FROM sx_retail_locations WHERE tenant_id=? ORDER BY status,is_default DESC,name_en,id`,[tenant]);
    res.json({success:true,data:rows});
  }));

  router.get('/', action('inventory.read', async (req, res, tenant) => {
    const offset = Number(req.query.offset || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) return res.sendStatus(400);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const location=await locationFor(pool,tenant,typeof req.query.locationId==='string'?req.query.locationId:null);
    if(!location)return res.sendStatus(404);
    const [items] = await pool.query(
      `SELECT p.id, p.code, p.name_en AS nameEn, p.name_ar AS nameAr,
         COALESCE(m.quantity, 0) AS quantity, CAST(COALESCE(m.id, 0) AS CHAR) AS revision,
         COALESCE((SELECT SUM(r.quantity) FROM sx_retail_stock_reservations r WHERE r.tenant_id=p.tenant_id AND r.product_id=p.id AND r.location_id=?),0) AS reserved,
         ? AS locationId
       FROM sx_product_catalog p
       LEFT JOIN sx_business_stock_movements m ON m.id = (
         SELECT id FROM sx_business_stock_movements WHERE tenant_id=p.tenant_id AND product_id=p.id AND location_id=? ORDER BY id DESC LIMIT 1
       )
       WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status<>'retired'
       AND (LOCATE(?,p.code)>0 OR LOCATE(?,p.name_en)>0 OR LOCATE(?,p.name_ar)>0)
       ORDER BY p.code,p.id LIMIT 51 OFFSET ?`, [location.id,location.id,tenant, search, search, search, offset]);
    res.json({success: true, data: {items: items.slice(0, 50), hasMore: items.length > 50}});
  }));

  router.get('/:id/history', action('inventory.read', async (req, res, tenant) => {
    if (!uuid.test(req.params.id)) return res.sendStatus(404);
    const location=await locationFor(pool,tenant,typeof req.query.locationId==='string'?req.query.locationId:null);
    if(!location)return res.sendStatus(404);
    const [items] = await pool.query(
      `SELECT previous_quantity AS previousQuantity, quantity, reason, created_at AS createdAt
       FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=? ORDER BY id DESC LIMIT 50`,
      [tenant, req.params.id,location.id]);
    res.json({success: true, data: items});
  }));

  router.post('/locations', action('inventory.manage', async (req,res,tenant)=>{
    const body=req.body||{},code=typeof body.code==='string'?body.code.trim().toLowerCase():'';
    const nameEn=typeof body.nameEn==='string'?body.nameEn.trim():'';
    const nameAr=typeof body.nameAr==='string'?body.nameAr.trim():'';
    const address=typeof body.address==='string'?body.address.trim():'';
    const pin=typeof body.mapPin==='string'?body.mapPin.trim():'';
    const acceptsPickup=body.acceptsPickup===true,acceptsDelivery=body.acceptsDelivery===true;
    if(!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(code)||!nameEn||nameEn.length>120||nameAr.length>120||address.length>500||
      (pin&&!/^(-?\d{1,3}(?:\.\d{1,8})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,8})?)$/.test(pin))||
      (!acceptsPickup&&!acceptsDelivery))return res.sendStatus(400);
    const mapPin=pin?pin.replace(/\s/g,''):null;
    if(mapPin){const [lat,lon]=mapPin.split(',').map(Number);if(Math.abs(lat)>90||Math.abs(lon)>180)return res.sendStatus(400);}
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenant]);
      const [[existing]]=await db.query('SELECT id FROM sx_retail_locations WHERE tenant_id=? AND code=?',[tenant,code]);
      if(existing){await db.rollback();return res.sendStatus(409);}
      const [[defaults]]=await db.query("SELECT COUNT(*) AS count FROM sx_retail_locations WHERE tenant_id=? AND status='active' AND is_default=1 FOR UPDATE",[tenant]);
      const id=randomUUID();
      await db.query(`INSERT INTO sx_retail_locations
        (id,tenant_id,code,name_en,name_ar,address,map_pin,accepts_pickup,accepts_delivery,is_default,status)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'active')`,[id,tenant,code,nameEn,nameAr,address,mapPin,acceptsPickup?1:0,acceptsDelivery?1:0,Number(defaults.count)?0:1]);
      await db.commit();res.json({success:true,data:{id,code,nameEn,nameAr,address,mapPin,acceptsPickup,acceptsDelivery,isDefault:!Number(defaults.count),status:'active'}});
    }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')return res.sendStatus(409);throw error;}
    finally{db.release();}
  }));

  router.put('/locations/:id', action('inventory.manage', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const body=req.body||{},nameEn=typeof body.nameEn==='string'?body.nameEn.trim():'',nameAr=typeof body.nameAr==='string'?body.nameAr.trim():'',
      address=typeof body.address==='string'?body.address.trim():'',pin=typeof body.mapPin==='string'?body.mapPin.trim():'',
      acceptsPickup=body.acceptsPickup===true,acceptsDelivery=body.acceptsDelivery===true;
    if(!nameEn||nameEn.length>120||nameAr.length>120||address.length>500||
      (pin&&!/^(-?\d{1,3}(?:\.\d{1,8})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,8})?)$/.test(pin))||
      (!acceptsPickup&&!acceptsDelivery))return res.sendStatus(400);
    const mapPin=pin?pin.replace(/\s/g,''):null;
    if(mapPin){const [lat,lon]=mapPin.split(',').map(Number);if(Math.abs(lat)>90||Math.abs(lon)>180)return res.sendStatus(400);}
    const [updated]=await pool.query(`UPDATE sx_retail_locations SET name_en=?,name_ar=?,address=?,map_pin=?,accepts_pickup=?,accepts_delivery=?
      WHERE tenant_id=? AND id=? AND status='active'`,[nameEn,nameAr,address,mapPin,acceptsPickup?1:0,acceptsDelivery?1:0,tenant,req.params.id]);
    if(!updated.affectedRows)return res.sendStatus(404);
    res.json({success:true,data:{id:req.params.id,nameEn,nameAr,address,mapPin,acceptsPickup,acceptsDelivery}});
  }));

  router.post('/locations/:id/default', action('inventory.manage', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenant]);
      const [[location]]=await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE",[tenant,req.params.id]);
      if(!location){await db.rollback();return res.sendStatus(404);}
      await db.query('UPDATE sx_retail_locations SET is_default=0 WHERE tenant_id=?',[tenant]);
      await db.query('UPDATE sx_retail_locations SET is_default=1 WHERE tenant_id=? AND id=?',[tenant,req.params.id]);
      await db.commit();res.json({success:true,data:{id:req.params.id,isDefault:true}});
    }catch(error){await db.rollback();throw error;}finally{db.release();}
  }));

  router.post('/locations/:id/archive', action('inventory.manage', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenant]);
      const [[location]]=await db.query('SELECT is_default AS isDefault,status FROM sx_retail_locations WHERE tenant_id=? AND id=? FOR UPDATE',[tenant,req.params.id]);
      if(!location){await db.rollback();return res.sendStatus(404);}
      if(location.status==='archived'){await db.commit();return res.json({success:true,data:{archived:true}});}
      if(Number(location.isDefault)){await db.rollback();return res.status(409).json({success:false,code:'DEFAULT_LOCATION_REQUIRED'});}
      const [[stock]]=await db.query(`SELECT COALESCE(SUM(balance.quantity),0) AS quantity FROM (
        SELECT m.quantity FROM sx_business_stock_movements m WHERE m.tenant_id=? AND m.location_id=?
          AND m.id=(SELECT MAX(last.id) FROM sx_business_stock_movements last WHERE last.tenant_id=m.tenant_id AND last.product_id=m.product_id AND last.location_id=m.location_id)
      ) balance`,[tenant,req.params.id]);
      const [[open]]=await db.query("SELECT COUNT(*) AS count FROM sx_retail_orders WHERE tenant_id=? AND location_id=? AND status IN ('placed','ready','dispatched')",[tenant,req.params.id]);
      const [[reserved]]=await db.query('SELECT COALESCE(SUM(quantity),0) AS count FROM sx_retail_stock_reservations WHERE tenant_id=? AND location_id=?',[tenant,req.params.id]);
      const [[publishing]]=await db.query("SELECT COUNT(*) AS count FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND stock_location_id=? AND publish_stock=1 AND mapping_status='active'",[tenant,req.params.id]);
      if(Number(publishing.count)){await db.rollback();return res.status(409).json({success:false,code:'LOCATION_USED_BY_STORE_SYNC'});}
      if(Number(stock.quantity)>0||Number(open.count)>0||Number(reserved.count)>0){await db.rollback();return res.status(409).json({success:false,code:'LOCATION_STOCK_OR_ORDERS_REMAIN'});}
      await db.query("UPDATE sx_retail_locations SET status='archived',is_default=0 WHERE tenant_id=? AND id=?",[tenant,req.params.id]);
      await db.commit();res.json({success:true,data:{archived:true}});
    }catch(error){await db.rollback();throw error;}finally{db.release();}
  }));

  router.post('/locations/:id/restore', action('inventory.manage', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenant]);
      const [[location]]=await db.query('SELECT id,status,is_default AS isDefault FROM sx_retail_locations WHERE tenant_id=? AND id=? FOR UPDATE',[tenant,req.params.id]);
      if(!location){await db.rollback();return res.sendStatus(404);}
      if(location.status==='active'){await db.commit();return res.json({success:true,data:{active:true}});}
      await db.query("UPDATE sx_retail_locations SET status='active',is_default=0 WHERE tenant_id=? AND id=?",[tenant,req.params.id]);
      await db.commit();res.json({success:true,data:{active:true,isDefault:false}});
    }catch(error){await db.rollback();throw error;}finally{db.release();}
  }));

  router.post('/stock/transfers', action('inventory.manage', async (req,res,tenant)=>{
    const body=req.body||{},productId=typeof body.productId==='string'?body.productId.toLowerCase():body.productId,
      sourceId=typeof body.sourceLocationId==='string'?body.sourceLocationId.toLowerCase():body.sourceLocationId,
      targetId=typeof body.targetLocationId==='string'?body.targetLocationId.toLowerCase():body.targetLocationId,
      requestId=typeof body.requestId==='string'?body.requestId.toLowerCase():body.requestId,quantity=body.quantity,
      reason=typeof body.reason==='string'?body.reason.trim():'';
    if(!uuid.test(productId||'')||!uuid.test(sourceId||'')||!uuid.test(targetId||'')||sourceId===targetId||!uuid.test(requestId||'')||
      !Number.isInteger(quantity)||quantity<1||quantity>1000000000||!reason||reason.length>200)return res.sendStatus(400);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      const [[product]]=await db.query("SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND status<>'retired' AND deleted_at IS NULL FOR UPDATE",[tenant,productId]);
      if(!product){await db.rollback();return res.sendStatus(404);}
      const [[prior]]=await db.query('SELECT id,product_id AS productId,source_location_id AS sourceId,target_location_id AS targetId,quantity,reason FROM sx_retail_stock_transfers WHERE tenant_id=? AND request_id=? FOR UPDATE',[tenant,requestId]);
      if(prior){await db.rollback();if(prior.productId!==productId||prior.sourceId!==sourceId||prior.targetId!==targetId||Number(prior.quantity)!==quantity||prior.reason!==reason)return res.sendStatus(409);return res.json({success:true,data:{id:prior.id,replayed:true}});}
      const ids=[sourceId,targetId].sort();
      const [locations]=await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id IN (?) AND status='active' ORDER BY id FOR UPDATE",[tenant,ids]);
      if(locations.length!==2){await db.rollback();return res.sendStatus(404);}
      const balances=[];
      for(const locationId of ids){const [[row]]=await db.query('SELECT quantity,CAST(id AS CHAR) AS revision FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[tenant,productId,locationId]);balances.push({locationId,quantity:Number(row?.quantity||0),revision:row?.revision||'0'});}
      const source=balances.find(row=>row.locationId===sourceId),target=balances.find(row=>row.locationId===targetId);
      if(source.quantity<quantity){await db.rollback();return res.status(409).json({success:false,code:'STOCK_CHANGED'});}
      if(target.quantity+quantity>1000000000){await db.rollback();return res.status(409).json({success:false,code:'STOCK_LIMIT'});}
      const [[reserved]]=await db.query('SELECT COALESCE(SUM(quantity),0) AS quantity FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? AND location_id=?',[tenant,productId,sourceId]);
      if(source.quantity-quantity<Number(reserved.quantity)){await db.rollback();return res.status(409).json({success:false,code:'STOCK_RESERVED'});}
      const outId=randomUUID(),actor=req.businessContext.identity.id;
      for(const [locationId,previous,next,revision,direction] of [[sourceId,source.quantity,source.quantity-quantity,source.revision,'out'],[targetId,target.quantity,target.quantity+quantity,target.revision,'in']]){
        await db.query(`INSERT INTO sx_business_stock_movements
          (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_quantity,quantity,reason)
          VALUES (?,?,?,?,?,?,?,?,?)`,[tenant,productId,locationId,requestId,actor,revision,previous,next,`Transfer ${direction}: ${reason}`]);
      }
      await retailProductSync.enqueueProductChange(db,tenant,productId,sourceId);
      await retailProductSync.enqueueProductChange(db,tenant,productId,targetId);
      await db.query(`INSERT INTO sx_retail_stock_transfers
        (id,tenant_id,request_id,product_id,source_location_id,target_location_id,quantity,reason,actor_identity_id)
        VALUES (?,?,?,?,?,?,?,?,?)`,[outId,tenant,requestId,productId,sourceId,targetId,quantity,reason,actor]);
      await db.commit();res.json({success:true,data:{id:outId,replayed:false}});
    }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')return res.sendStatus(409);throw error;}finally{db.release();}
  }));

  router.post('/:id/count', action('inventory.manage', async (req, res, tenant) => {
    const {requestId, expectedRevision, quantity, reason} = req.body || {};
    if (!uuid.test(req.params.id) || typeof requestId !== 'string' || !uuid.test(requestId) ||
        !validQuantity(quantity) || typeof expectedRevision !== 'string' || !/^\d{1,20}$/.test(expectedRevision) || typeof reason !== 'string' ||
        !reason.trim() || reason.trim().length > 200 || (req.body?.locationId!=null&&!uuid.test(req.body.locationId))) return res.sendStatus(400);

    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const [[product]] = await db.query(
        "SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND status<>'retired' FOR UPDATE",
        [tenant, req.params.id]);
      if (!product) {
        await db.rollback();
        return res.sendStatus(404);
      }
      const location=await locationFor(db,tenant,req.body?.locationId||null,true);
      if(!location){await db.rollback();return res.sendStatus(404);}
      const key = [tenant, product.id,location.id];
      const [[prior]] = await db.query(
        'SELECT quantity, previous_revision AS previousRevision, reason FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=? AND request_id=?',
        [...key, requestId.toLowerCase()]);
      if (prior) {
        await db.rollback();
        if (prior.quantity !== quantity || prior.previousRevision !== expectedRevision || prior.reason !== reason.trim()) return res.sendStatus(409);
        return res.json({success: true, data: prior});
      }
      const [[latest]] = await db.query(
        'SELECT quantity, CAST(id AS CHAR) AS revision FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=? ORDER BY id DESC LIMIT 1', key);
      if ((latest?.revision ?? '0') !== expectedRevision) {
        await db.rollback();
        return res.status(409).json({success: false, code: 'STOCK_CHANGED'});
      }
      const [[reserved]]=await db.query(
        'SELECT COALESCE(SUM(quantity),0) AS quantity FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? AND location_id=?',key);
      if (quantity < Number(reserved.quantity)) {
        await db.rollback();
        return res.status(409).json({success:false,code:'STOCK_RESERVED'});
      }
      await db.query(
        'INSERT INTO sx_business_stock_movements (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_quantity,quantity,reason) VALUES (?,?,?,?,?,?,?,?,?)',
        [...key, requestId.toLowerCase(), req.businessContext.identity.id, expectedRevision, latest?.quantity ?? 0, quantity, reason.trim()]);
      await retailProductSync.enqueueProductChange(db,tenant,req.params.id,location.id);
      await db.commit();
      res.json({success: true, data: {quantity}});
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  }));
  return router;
};
