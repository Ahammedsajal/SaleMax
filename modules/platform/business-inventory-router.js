'use strict';

const express = require('express');
const { decision } = require('./policy');
const { randomUUID, createHash } = require('node:crypto');
const quantity = require('./retail-quantity');
const inventoryAlerts = require('./retail-inventory-alerts');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const unitCodes = new Set(['unit','yard','piece','panel','custom']);
const quantityAmountSafe = value => {
  const amount=quantity.scaled(value);
  return amount!==null&&amount<=quantity.MAX?amount:null;
};

module.exports = function createInventoryRouter({pool, authenticate}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  }, authenticate, express.json({limit: '32kb'}));

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

  async function ensureUnitVersion(db,tenant,productId,unit,actorIdentityId){
    const configured=Boolean(unit),revision=Number(unit?.revision||0);
    await db.query(`INSERT INTO sx_retail_product_inventory_unit_versions
      (tenant_id,product_id,revision,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,change_reason,actor_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE revision=VALUES(revision)`,[
      tenant,productId,revision,unit?.baseUnitCode||'unit',unit?.baseUnitLabel||'',unit?.baseUnitLabelAr||'',
      Number(unit?.quantityPrecision||0),unit?.quantityIncrement||'1.000000',configured?'configured':'legacy_default',
      configured?(unit?.updatedByIdentityId||actorIdentityId||null):null]);
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
         CAST(COALESCE(m.quantity, 0) AS CHAR) AS quantity, CAST(COALESCE(m.id, 0) AS CHAR) AS revision,
         CAST(COALESCE((SELECT SUM(r.quantity) FROM sx_retail_stock_reservations r WHERE r.tenant_id=p.tenant_id AND r.product_id=p.id AND r.location_id=?),0) AS CHAR) AS reserved,
         COALESCE(u.base_unit_code,'unit') AS baseUnitCode,COALESCE(u.base_unit_label,'') AS baseUnitLabel,COALESCE(u.base_unit_label_ar,'') AS baseUnitLabelAr,
         COALESCE(u.quantity_precision,0) AS quantityPrecision,CAST(COALESCE(u.quantity_increment,1.000000) AS CHAR) AS quantityIncrement,
         COALESCE(u.revision,0) AS unitRevision,CAST(t.low_stock_threshold AS CHAR) AS lowStockThreshold,
         COALESCE(t.revision,0) AS thresholdRevision,
         ? AS locationId
       FROM sx_product_catalog p
       LEFT JOIN sx_business_stock_movements m ON m.id = (
         SELECT id FROM sx_business_stock_movements WHERE tenant_id=p.tenant_id AND product_id=p.id AND location_id=? ORDER BY id DESC LIMIT 1
       )
       LEFT JOIN sx_retail_product_inventory_units u ON u.tenant_id=p.tenant_id AND u.product_id=p.id
       LEFT JOIN sx_retail_inventory_location_thresholds t ON t.tenant_id=p.tenant_id AND t.product_id=p.id AND t.location_id=?
       WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status<>'retired'
       AND (LOCATE(?,p.code)>0 OR LOCATE(?,p.name_en)>0 OR LOCATE(?,p.name_ar)>0)
       ORDER BY p.code,p.id LIMIT 51 OFFSET ?`, [location.id,location.id,location.id,location.id,tenant, search, search, search, offset]);
    const normalized=items.slice(0,50).map(item=>{
      const onHand=quantity.scaled(item.quantity)||0n,reserved=quantity.scaled(item.reserved)||0n;
      const available=onHand>=reserved?onHand-reserved:0n,threshold=item.lowStockThreshold===null?null:quantity.scaled(item.lowStockThreshold);
      return {...item,quantityPrecision:Number(item.quantityPrecision),unitRevision:Number(item.unitRevision),thresholdRevision:Number(item.thresholdRevision),
        quantity:quantity.json(onHand,Number(item.quantityPrecision)),reserved:quantity.json(reserved,Number(item.quantityPrecision)),
        availableQuantity:quantity.json(available,Number(item.quantityPrecision)),quantityIncrement:quantity.format(quantity.scaled(item.quantityIncrement),Number(item.quantityPrecision)),
        lowStock:threshold!==null&&available<=threshold};
    });
    res.json({success: true, data: {items: normalized, hasMore: items.length > 50}});
  }));

  router.get('/:id/history', action('inventory.read', async (req, res, tenant) => {
    if (!uuid.test(req.params.id)) return res.sendStatus(404);
    const location=await locationFor(pool,tenant,typeof req.query.locationId==='string'?req.query.locationId:null);
    if(!location)return res.sendStatus(404);
    const [items] = await pool.query(
      `SELECT CAST(m.previous_quantity AS CHAR) AS previousQuantity,CAST(m.quantity AS CHAR) AS quantity,m.reason,m.created_at AS createdAt,
        m.previous_unit_revision AS previousUnitRevision,m.unit_revision AS unitRevision,
        COALESCE(pv.base_unit_code,'unit') AS previousUnitCode,COALESCE(pv.base_unit_label,'') AS previousUnitLabel,
        COALESCE(pv.base_unit_label_ar,'') AS previousUnitLabelAr,COALESCE(pv.quantity_precision,0) AS previousQuantityPrecision,
        COALESCE(v.base_unit_code,'unit') AS unitCode,COALESCE(v.base_unit_label,'') AS unitLabel,
        COALESCE(v.base_unit_label_ar,'') AS unitLabelAr,COALESCE(v.quantity_precision,0) AS quantityPrecision
       FROM sx_business_stock_movements m
       LEFT JOIN sx_retail_product_inventory_unit_versions pv ON pv.tenant_id=m.tenant_id AND pv.product_id=m.product_id AND pv.revision=m.previous_unit_revision
       LEFT JOIN sx_retail_product_inventory_unit_versions v ON v.tenant_id=m.tenant_id AND v.product_id=m.product_id AND v.revision=m.unit_revision
       WHERE m.tenant_id=? AND m.product_id=? AND m.location_id=? ORDER BY m.id DESC LIMIT 50`,
      [tenant, req.params.id,location.id]);
    for(const item of items){
      item.previousQuantityPrecision=Number(item.previousQuantityPrecision);item.quantityPrecision=Number(item.quantityPrecision);
      item.previousQuantity=quantity.format(quantity.scaled(item.previousQuantity),item.previousQuantityPrecision);
      item.quantity=quantity.format(quantity.scaled(item.quantity),item.quantityPrecision);
      item.previousUnit={baseUnitCode:item.previousUnitCode,baseUnitLabel:item.previousUnitLabel,baseUnitLabelAr:item.previousUnitLabelAr};
      item.unit={baseUnitCode:item.unitCode,baseUnitLabel:item.unitLabel,baseUnitLabelAr:item.unitLabelAr};
      delete item.previousUnitCode;delete item.previousUnitLabel;delete item.previousUnitLabelAr;delete item.unitCode;delete item.unitLabel;delete item.unitLabelAr;
    }
    res.json({success: true, data: items});
  }));

  router.get('/products/:id/unit/rebase-preview', action('inventory.read', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const [[product]]=await pool.query(`SELECT p.id,COALESCE(u.base_unit_code,'unit') AS baseUnitCode,COALESCE(u.base_unit_label,'') AS baseUnitLabel,
      COALESCE(u.base_unit_label_ar,'') AS baseUnitLabelAr,COALESCE(u.quantity_precision,0) AS quantityPrecision,
      CAST(COALESCE(u.quantity_increment,1.000000) AS CHAR) AS quantityIncrement,COALESCE(u.revision,0) AS unitRevision
      FROM sx_product_catalog p LEFT JOIN sx_retail_product_inventory_units u ON u.tenant_id=p.tenant_id AND u.product_id=p.id
      WHERE p.tenant_id=? AND p.id=? AND p.deleted_at IS NULL AND p.status<>'retired'`,[tenant,req.params.id]);
    if(!product)return res.sendStatus(404);
    const [locations]=await pool.query(`SELECT l.id,l.code,l.name_en AS nameEn,l.name_ar AS nameAr,l.status,
      CAST(COALESCE((SELECT m.quantity FROM sx_business_stock_movements m WHERE m.tenant_id=l.tenant_id AND m.product_id=? AND m.location_id=l.id ORDER BY m.id DESC LIMIT 1),'0.000000') AS CHAR) AS currentQuantity,
      CAST(COALESCE((SELECT m.id FROM sx_business_stock_movements m WHERE m.tenant_id=l.tenant_id AND m.product_id=? AND m.location_id=l.id ORDER BY m.id DESC LIMIT 1),0) AS CHAR) AS expectedStockRevision,
      CAST(COALESCE((SELECT SUM(r.quantity) FROM sx_retail_stock_reservations r WHERE r.tenant_id=l.tenant_id AND r.product_id=? AND r.location_id=l.id),0) AS CHAR) AS reserved
      FROM sx_retail_locations l WHERE l.tenant_id=? ORDER BY l.status,l.is_default DESC,l.name_en,l.id`,[req.params.id,req.params.id,req.params.id,tenant]);
    const [[activity]]=await pool.query(`SELECT
      EXISTS(SELECT 1 FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? LIMIT 1) AS hasMovement,
      EXISTS(SELECT 1 FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? LIMIT 1) AS hasReservations,
      EXISTS(SELECT 1 FROM sx_retail_orders WHERE tenant_id=? AND JSON_SEARCH(order_lines,'one',?,NULL,'$[*].id') IS NOT NULL AND status IN ('placed','ready','dispatched') LIMIT 1) AS hasOpenOrders`,
    [tenant,req.params.id,tenant,req.params.id,tenant,req.params.id]);
    const hasReservations=Number(activity.hasReservations)>0,hasOpenOrders=Number(activity.hasOpenOrders)>0;
    const archivedStock=locations.some(row=>row.status==='archived'&&quantity.scaled(row.currentQuantity)>0n);
    const locationLimitExceeded=locations.length>100;
    res.json({success:true,data:{product:{baseUnitCode:product.baseUnitCode,baseUnitLabel:product.baseUnitLabel,baseUnitLabelAr:product.baseUnitLabelAr,
      quantityPrecision:Number(product.quantityPrecision),quantityIncrement:quantity.format(quantity.scaled(product.quantityIncrement),Number(product.quantityPrecision)),unitRevision:Number(product.unitRevision)},
      locations:locations.map(row=>({...row,currentQuantity:quantity.json(quantity.scaled(row.currentQuantity)||0n),reserved:quantity.json(quantity.scaled(row.reserved)||0n)})),
      hasMovement:Number(activity.hasMovement)>0,hasReservations,hasOpenOrders,archivedStock,
      locationLimitExceeded,canRebase:Number(activity.hasMovement)>0&&!hasReservations&&!hasOpenOrders&&!archivedStock&&!locationLimitExceeded}});
  }));

  router.put('/products/:id/unit', action('inventory.manage', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const body=req.body||{},baseUnitCode=typeof body.baseUnitCode==='string'?body.baseUnitCode:'',baseUnitLabel=typeof body.baseUnitLabel==='string'?body.baseUnitLabel.trim():'',
      baseUnitLabelAr=typeof body.baseUnitLabelAr==='string'?body.baseUnitLabelAr.trim():'';
    const precisionValue=body.quantityPrecision,unitStep=quantity.scaled(body.quantityIncrement),expectedRevision=body.expectedRevision;
    if(!unitCodes.has(baseUnitCode)||!Number.isInteger(precisionValue)||precisionValue<0||precisionValue>6||
      (baseUnitCode==='custom'&&(!baseUnitLabel||!baseUnitLabelAr||baseUnitLabel.length>24||baseUnitLabelAr.length>24))||
      (baseUnitCode!=='custom'&&(baseUnitLabel.length>24||baseUnitLabelAr.length>24))||unitStep===null||unitStep<=0n||!quantity.atPrecision(unitStep,precisionValue)||
      typeof expectedRevision!=='string'||!/^\d{1,10}$/.test(expectedRevision))return res.sendStatus(400);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      const [[product]]=await db.query("SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND status<>'retired' FOR UPDATE",[tenant,req.params.id]);
      if(!product){await db.rollback();return res.sendStatus(404);}
      const [[current]]=await db.query(`SELECT base_unit_code AS baseUnitCode,base_unit_label AS baseUnitLabel,base_unit_label_ar AS baseUnitLabelAr,
        quantity_precision AS quantityPrecision,CAST(quantity_increment AS CHAR) AS quantityIncrement,revision
        FROM sx_retail_product_inventory_units WHERE tenant_id=? AND product_id=? FOR UPDATE`,[tenant,req.params.id]);
      const currentRevision=Number(current?.revision||0);
      if(currentRevision!==Number(expectedRevision)){await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_UNIT_CHANGED'});}
      const nextLabel=baseUnitCode==='custom'?baseUnitLabel:'',nextLabelAr=baseUnitCode==='custom'?baseUnitLabelAr:'';
      const changed=(current?.baseUnitCode||'unit')!==baseUnitCode||Number(current?.quantityPrecision||0)!==precisionValue||
        (current?.baseUnitLabel||'')!==nextLabel||(current?.baseUnitLabelAr||'')!==nextLabelAr||
        (quantity.scaled(current?.quantityIncrement||'1.000000')!==unitStep);
      if(!changed){
        await db.commit();
        return res.json({success:true,data:{baseUnitCode:current?.baseUnitCode||'unit',baseUnitLabel:current?.baseUnitLabel||'',
          baseUnitLabelAr:current?.baseUnitLabelAr||'',quantityPrecision:Number(current?.quantityPrecision||0),
          quantityIncrement:quantity.format(quantity.scaled(current?.quantityIncrement||'1.000000'),Number(current?.quantityPrecision||0)),
          revision:currentRevision,thresholdsDisabled:false}});
      }
      if(changed){
        const [[activity]]=await db.query(`SELECT
          EXISTS(SELECT 1 FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? LIMIT 1) AS hasMovement,
          EXISTS(SELECT 1 FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? LIMIT 1) AS hasReservation,
          EXISTS(SELECT 1 FROM sx_retail_orders WHERE tenant_id=? AND JSON_SEARCH(order_lines,'one',?,NULL,'$[*].id') IS NOT NULL LIMIT 1) AS hasOrder`,
        [tenant,req.params.id,tenant,req.params.id,tenant,req.params.id]);
        if(Number(activity.hasMovement)||Number(activity.hasReservation)||Number(activity.hasOrder)){
          await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_UNIT_LOCKED'});
        }
      }
      const revision=currentRevision+1;
      await db.query(`INSERT INTO sx_retail_product_inventory_units
        (tenant_id,product_id,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,revision,updated_by_identity_id)
        VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE base_unit_code=VALUES(base_unit_code),base_unit_label=VALUES(base_unit_label),base_unit_label_ar=VALUES(base_unit_label_ar),
        quantity_precision=VALUES(quantity_precision),quantity_increment=VALUES(quantity_increment),revision=VALUES(revision),updated_by_identity_id=VALUES(updated_by_identity_id)`,
      [tenant,req.params.id,baseUnitCode,nextLabel,nextLabelAr,precisionValue,quantity.fixed(unitStep),revision,req.businessContext.identity.id]);
      await db.query(`INSERT INTO sx_retail_product_inventory_unit_versions
        (tenant_id,product_id,revision,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,change_reason,actor_identity_id)
        VALUES (?,?,?,?,?,?,?,?,'configured',?)`,[tenant,req.params.id,revision,baseUnitCode,nextLabel,
        nextLabelAr,precisionValue,quantity.fixed(unitStep),req.businessContext.identity.id]);
      let thresholdsDisabled=false;
      if(changed){
        const [cleared]=await db.query(`UPDATE sx_retail_inventory_location_thresholds SET low_stock_threshold=NULL,revision=revision+1,updated_by_identity_id=?
          WHERE tenant_id=? AND product_id=? AND low_stock_threshold IS NOT NULL`,[req.businessContext.identity.id,tenant,req.params.id]);
        thresholdsDisabled=Number(cleared.affectedRows)>0;
        await db.query(`UPDATE sx_retail_inventory_alert_states SET observed_state='unknown',notified_state='unknown',available_quantity=NULL,
          low_stock_threshold=NULL,transition_revision=transition_revision+1 WHERE tenant_id=? AND product_id=?`,[tenant,req.params.id]);
      }
      await db.commit();
      res.json({success:true,data:{baseUnitCode,baseUnitLabel:nextLabel,baseUnitLabelAr:nextLabelAr,quantityPrecision:precisionValue,quantityIncrement:quantity.format(unitStep,precisionValue),revision,thresholdsDisabled}});
    }catch(error){await db.rollback();throw error;}finally{db.release();}
  }));

  router.post('/products/:id/unit/rebase', action('inventory.manage', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const body=req.body||{},baseUnitCode=typeof body.baseUnitCode==='string'?body.baseUnitCode:'',baseUnitLabel=typeof body.baseUnitLabel==='string'?body.baseUnitLabel.trim():'',
      baseUnitLabelAr=typeof body.baseUnitLabelAr==='string'?body.baseUnitLabelAr.trim():'',precisionValue=body.quantityPrecision,
      unitStep=quantity.scaled(body.quantityIncrement),expectedUnitRevision=body.expectedUnitRevision,requestId=typeof body.requestId==='string'?body.requestId.toLowerCase():'',
      reason=typeof body.reason==='string'?body.reason.trim():'';
    const inputCounts=Array.isArray(body.locations)?body.locations:[];
    if(!uuid.test(requestId)||!unitCodes.has(baseUnitCode)||!Number.isInteger(precisionValue)||precisionValue<0||precisionValue>6||
      (baseUnitCode==='custom'&&(!baseUnitLabel||!baseUnitLabelAr||baseUnitLabel.length>24||baseUnitLabelAr.length>24))||
      (baseUnitCode!=='custom'&&(baseUnitLabel.length>24||baseUnitLabelAr.length>24))||unitStep===null||unitStep<=0n||!quantity.atPrecision(unitStep,precisionValue)||
      typeof expectedUnitRevision!=='string'||!/^(0|[1-9]\d{0,9})$/.test(expectedUnitRevision)||!reason||reason.length>120||!inputCounts.length||inputCounts.length>100)return res.sendStatus(400);
    const locations=inputCounts.map(row=>({
      locationId:typeof row?.locationId==='string'?row.locationId.toLowerCase():'',
      expectedStockRevision:typeof row?.expectedStockRevision==='string'?row.expectedStockRevision:'',
      quantity:quantity.scaled(row?.quantity),
    })).sort((a,b)=>a.locationId<b.locationId?-1:a.locationId>b.locationId?1:0);
    if(locations.some(row=>!uuid.test(row.locationId)||!/^(0|[1-9]\d{0,19})$/.test(row.expectedStockRevision)||row.quantity===null||
      !quantity.atPrecision(row.quantity,precisionValue)||!quantity.isMultiple(row.quantity,unitStep))||new Set(locations.map(row=>row.locationId)).size!==locations.length)return res.sendStatus(400);
    const request={baseUnitCode,baseUnitLabel:baseUnitCode==='custom'?baseUnitLabel:'',baseUnitLabelAr:baseUnitCode==='custom'?baseUnitLabelAr:'',
      quantityPrecision:precisionValue,quantityIncrement:quantity.fixed(unitStep),expectedUnitRevision,reason,locations:locations.map(row=>({
        locationId:row.locationId,expectedStockRevision:row.expectedStockRevision,quantity:quantity.fixed(row.quantity)}))};
    const requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex'),db=await pool.getConnection();
    try{
      await db.beginTransaction();
      await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenant]);
      const [[product]]=await db.query("SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND status<>'retired' FOR UPDATE",[tenant,req.params.id]);
      if(!product){await db.rollback();return res.sendStatus(404);}
      const [[prior]]=await db.query('SELECT id,request_hash AS requestHash,revision FROM sx_retail_inventory_unit_rebases WHERE tenant_id=? AND product_id=? AND request_id=? FOR UPDATE',
        [tenant,req.params.id,requestId]);
      if(prior){await db.rollback();if(prior.requestHash!==requestHash)return res.sendStatus(409);return res.json({success:true,data:{id:prior.id,unitRevision:Number(prior.revision),replayed:true,thresholdsDisabled:true}});}
      const [[current]]=await db.query(`SELECT base_unit_code AS baseUnitCode,base_unit_label AS baseUnitLabel,base_unit_label_ar AS baseUnitLabelAr,
        quantity_precision AS quantityPrecision,CAST(quantity_increment AS CHAR) AS quantityIncrement,revision
        FROM sx_retail_product_inventory_units WHERE tenant_id=? AND product_id=? FOR UPDATE`,[tenant,req.params.id]);
      const previousRevision=Number(current?.revision||0);
      if(previousRevision!==Number(expectedUnitRevision)){await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_UNIT_CHANGED'});}
      const [[activity]]=await db.query(`SELECT
        EXISTS(SELECT 1 FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? LIMIT 1) AS hasMovement,
        EXISTS(SELECT 1 FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? LIMIT 1) AS hasReservations,
        EXISTS(SELECT 1 FROM sx_retail_orders WHERE tenant_id=? AND JSON_SEARCH(order_lines,'one',?,NULL,'$[*].id') IS NOT NULL AND status IN ('placed','ready','dispatched') LIMIT 1) AS hasOpenOrders`,
      [tenant,req.params.id,tenant,req.params.id,tenant,req.params.id]);
      if(!Number(activity.hasMovement)){await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_REBASE_NOT_REQUIRED'});}
      if(Number(activity.hasReservations)||Number(activity.hasOpenOrders)){await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_REBASE_HAS_OPEN_STOCK'});}
      const [allLocations]=await db.query('SELECT id,status FROM sx_retail_locations WHERE tenant_id=? ORDER BY id FOR UPDATE',[tenant]);
      if(allLocations.length!==locations.length||allLocations.some((row,index)=>row.id!==locations[index].locationId)){
        await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_REBASE_LOCATIONS_CHANGED'});
      }
      const currentProfile={baseUnitCode:current?.baseUnitCode||'unit',baseUnitLabel:current?.baseUnitLabel||'',baseUnitLabelAr:current?.baseUnitLabelAr||'',
        quantityPrecision:Number(current?.quantityPrecision||0),quantityIncrement:current?.quantityIncrement||'1.000000'};
      const nextProfile={baseUnitCode,baseUnitLabel:request.baseUnitLabel,baseUnitLabelAr:request.baseUnitLabelAr,
        quantityPrecision:precisionValue,quantityIncrement:request.quantityIncrement};
      if(JSON.stringify(currentProfile)===JSON.stringify(nextProfile)){
        await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_REBASE_UNIT_UNCHANGED'});
      }
      const locationsById=new Map(allLocations.map(row=>[row.id,row]));
      const revision=previousRevision+1,actor=req.businessContext.identity.id,rebaseId=randomUUID();
      await ensureUnitVersion(db,tenant,req.params.id,current,actor);
      await db.query(`INSERT INTO sx_retail_product_inventory_unit_versions
        (tenant_id,product_id,revision,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,change_reason,actor_identity_id)
        VALUES (?,?,?,?,?,?,?,?,'physical_recount',?)`,[tenant,req.params.id,revision,baseUnitCode,request.baseUnitLabel,request.baseUnitLabelAr,precisionValue,request.quantityIncrement,actor]);
      await db.query(`INSERT INTO sx_retail_inventory_unit_rebases
        (id,tenant_id,product_id,request_id,request_hash,previous_revision,revision,previous_profile_json,profile_json,reason,actor_identity_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[rebaseId,tenant,req.params.id,requestId,requestHash,previousRevision,revision,JSON.stringify(currentProfile),
        JSON.stringify({baseUnitCode,baseUnitLabel:request.baseUnitLabel,baseUnitLabelAr:request.baseUnitLabelAr,quantityPrecision:precisionValue,quantityIncrement:request.quantityIncrement}),reason,actor]);
      await db.query(`INSERT INTO sx_retail_product_inventory_units
        (tenant_id,product_id,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,revision,updated_by_identity_id)
        VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE base_unit_code=VALUES(base_unit_code),base_unit_label=VALUES(base_unit_label),
        base_unit_label_ar=VALUES(base_unit_label_ar),quantity_precision=VALUES(quantity_precision),quantity_increment=VALUES(quantity_increment),
        revision=VALUES(revision),updated_by_identity_id=VALUES(updated_by_identity_id)`,[tenant,req.params.id,baseUnitCode,request.baseUnitLabel,
        request.baseUnitLabelAr,precisionValue,request.quantityIncrement,revision,actor]);
      for(const item of locations){
        const [[latest]]=await db.query(`SELECT CAST(id AS CHAR) AS revision,CAST(quantity AS CHAR) AS quantity FROM sx_business_stock_movements
          WHERE tenant_id=? AND product_id=? AND location_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE`,[tenant,req.params.id,item.locationId]);
        if(String(latest?.revision||'0')!==item.expectedStockRevision){await db.rollback();return res.status(409).json({success:false,code:'STOCK_CHANGED'});}
        if(locationsById.get(item.locationId)?.status==='archived'&&
          ((quantity.scaled(latest?.quantity||'0')||0n)>0n||item.quantity>0n)){
          await db.rollback();return res.status(409).json({success:false,code:'INVENTORY_REBASE_ARCHIVED_STOCK'});
        }
        await db.query(`INSERT INTO sx_business_stock_movements
          (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_unit_revision,unit_revision,previous_quantity,quantity,reason,unit_rebase_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[tenant,req.params.id,item.locationId,requestId,actor,item.expectedStockRevision,previousRevision,revision,
          latest?.quantity||'0.000000',quantity.fixed(item.quantity),`Physical recount: ${currentProfile.baseUnitCode} -> ${baseUnitCode} · ${reason}`.slice(0,200),rebaseId]);
      }
      await db.query(`UPDATE sx_retail_inventory_location_thresholds SET low_stock_threshold=NULL,revision=revision+1,updated_by_identity_id=?
        WHERE tenant_id=? AND product_id=? AND low_stock_threshold IS NOT NULL`,[actor,tenant,req.params.id]);
      await db.query(`UPDATE sx_retail_inventory_alert_states SET observed_state='unknown',notified_state='unknown',available_quantity=NULL,
        low_stock_threshold=NULL,transition_revision=transition_revision+1 WHERE tenant_id=? AND product_id=?`,[tenant,req.params.id]);
      await db.commit();res.json({success:true,data:{id:rebaseId,unitRevision:revision,replayed:false,thresholdsDisabled:true}});
    }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')return res.sendStatus(409);throw error;}finally{db.release();}
  }));

  router.put('/products/:id/threshold', action('inventory.manage', async (req,res,tenant)=>{
    if(!uuid.test(req.params.id))return res.sendStatus(404);
    const body=req.body||{},locationId=typeof body.locationId==='string'?body.locationId.toLowerCase():'';
    if(!uuid.test(locationId)||typeof body.expectedRevision!=='string'||!/^\d{1,10}$/.test(body.expectedRevision)||
      (body.lowStockThreshold!==null&&quantity.scaled(body.lowStockThreshold)===null))return res.sendStatus(400);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      const [[product]]=await db.query("SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND status<>'retired' FOR UPDATE",[tenant,req.params.id]);
      const [[location]]=await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE",[tenant,locationId]);
      if(!product||!location){await db.rollback();return res.sendStatus(404);}
      const [[unit]]=await db.query('SELECT quantity_precision AS quantityPrecision,CAST(quantity_increment AS CHAR) AS quantityIncrement FROM sx_retail_product_inventory_units WHERE tenant_id=? AND product_id=?',[tenant,req.params.id]);
      const precisionValue=Number(unit?.quantityPrecision||0),increment=quantity.scaled(unit?.quantityIncrement||'1.000000'),threshold=body.lowStockThreshold===null?null:quantity.scaled(body.lowStockThreshold);
      if(threshold!==null&&(!quantity.atPrecision(threshold,precisionValue)||!quantity.isMultiple(threshold,increment))){
        await db.rollback();return res.sendStatus(400);
      }
      const [[current]]=await db.query('SELECT revision FROM sx_retail_inventory_location_thresholds WHERE tenant_id=? AND product_id=? AND location_id=? FOR UPDATE',[tenant,req.params.id,locationId]);
      const currentRevision=Number(current?.revision||0);
      if(currentRevision!==Number(body.expectedRevision)){await db.rollback();return res.status(409).json({success:false,code:'STOCK_THRESHOLD_CHANGED'});}
      const revision=currentRevision+1;
      await db.query(`INSERT INTO sx_retail_inventory_location_thresholds
        (tenant_id,product_id,location_id,low_stock_threshold,revision,updated_by_identity_id) VALUES (?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE low_stock_threshold=VALUES(low_stock_threshold),revision=VALUES(revision),updated_by_identity_id=VALUES(updated_by_identity_id)`,
      [tenant,req.params.id,locationId,threshold===null?null:quantity.fixed(threshold),revision,req.businessContext.identity.id]);
      await inventoryAlerts.evaluate(db,tenant,req.params.id,locationId);
      await db.commit();res.json({success:true,data:{locationId,lowStockThreshold:quantity.format(threshold,precisionValue),revision}});
    }catch(error){await db.rollback();throw error;}finally{db.release();}
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
      requestId=typeof body.requestId==='string'?body.requestId.toLowerCase():body.requestId,quantityAmount=quantity.scaled(body.quantity),
      reason=typeof body.reason==='string'?body.reason.trim():'';
    if(!uuid.test(productId||'')||!uuid.test(sourceId||'')||!uuid.test(targetId||'')||sourceId===targetId||!uuid.test(requestId||'')||
      quantityAmount===null||quantityAmount<=0n||!reason||reason.length>200)return res.sendStatus(400);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      const [[product]]=await db.query("SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND status<>'retired' AND deleted_at IS NULL FOR UPDATE",[tenant,productId]);
      if(!product){await db.rollback();return res.sendStatus(404);}
      const [[unit]]=await db.query(`SELECT base_unit_code AS baseUnitCode,base_unit_label AS baseUnitLabel,base_unit_label_ar AS baseUnitLabelAr,
        quantity_precision AS quantityPrecision,CAST(quantity_increment AS CHAR) AS quantityIncrement,revision,updated_by_identity_id AS updatedByIdentityId
        FROM sx_retail_product_inventory_units WHERE tenant_id=? AND product_id=? FOR UPDATE`,[tenant,productId]);
      const precisionValue=Number(unit?.quantityPrecision||0),increment=quantity.scaled(unit?.quantityIncrement||'1.000000'),unitRevision=Number(unit?.revision||0);
      if(!quantity.atPrecision(quantityAmount,precisionValue)||!quantity.isMultiple(quantityAmount,increment)){await db.rollback();return res.sendStatus(400);}
      const [[prior]]=await db.query('SELECT id,product_id AS productId,source_location_id AS sourceId,target_location_id AS targetId,quantity,reason FROM sx_retail_stock_transfers WHERE tenant_id=? AND request_id=? FOR UPDATE',[tenant,requestId]);
      if(prior){await db.rollback();if(prior.productId!==productId||prior.sourceId!==sourceId||prior.targetId!==targetId||quantity.scaled(prior.quantity)!==quantityAmount||prior.reason!==reason)return res.sendStatus(409);return res.json({success:true,data:{id:prior.id,replayed:true}});}
      const ids=[sourceId,targetId].sort();
      const [locations]=await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id IN (?) AND status='active' ORDER BY id FOR UPDATE",[tenant,ids]);
      if(locations.length!==2){await db.rollback();return res.sendStatus(404);}
      const balances=[];
      for(const locationId of ids){const [[row]]=await db.query('SELECT CAST(quantity AS CHAR) AS quantity,CAST(id AS CHAR) AS revision FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[tenant,productId,locationId]);balances.push({locationId,quantity:quantity.scaled(row?.quantity||'0')||0n,revision:row?.revision||'0'});}
      const source=balances.find(row=>row.locationId===sourceId),target=balances.find(row=>row.locationId===targetId);
      if(source.quantity<quantityAmount){await db.rollback();return res.status(409).json({success:false,code:'STOCK_CHANGED'});}
      const targetNext=quantity.add(target.quantity,quantityAmount),sourceNext=quantity.subtract(source.quantity,quantityAmount);
      if(targetNext===null||sourceNext===null){await db.rollback();return res.status(409).json({success:false,code:'STOCK_LIMIT'});}
      const [[reserved]]=await db.query('SELECT COALESCE(SUM(quantity),0) AS quantity FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? AND location_id=?',[tenant,productId,sourceId]);
      const reservedAmount=quantity.scaled(reserved.quantity||'0')||0n;
      if(sourceNext<reservedAmount){await db.rollback();return res.status(409).json({success:false,code:'STOCK_RESERVED'});}
      const outId=randomUUID(),actor=req.businessContext.identity.id;
      await ensureUnitVersion(db,tenant,productId,unit,actor);
      for(const [locationId,previous,next,revision,direction] of [[sourceId,source.quantity,sourceNext,source.revision,'out'],[targetId,target.quantity,targetNext,target.revision,'in']]){
        await db.query(`INSERT INTO sx_business_stock_movements
          (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_unit_revision,unit_revision,previous_quantity,quantity,reason)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[tenant,productId,locationId,requestId,actor,revision,unitRevision,unitRevision,quantity.fixed(previous),quantity.fixed(next),`Transfer ${direction}: ${reason}`]);
      }
      await db.query(`INSERT INTO sx_retail_stock_transfers
        (id,tenant_id,request_id,product_id,source_location_id,target_location_id,quantity,reason,actor_identity_id)
        VALUES (?,?,?,?,?,?,?,?,?)`,[outId,tenant,requestId,productId,sourceId,targetId,quantity.fixed(quantityAmount),reason,actor]);
      await inventoryAlerts.evaluate(db,tenant,productId,sourceId);
      await inventoryAlerts.evaluate(db,tenant,productId,targetId);
      await db.commit();res.json({success:true,data:{id:outId,replayed:false}});
    }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')return res.sendStatus(409);throw error;}finally{db.release();}
  }));

  router.post('/:id/count', action('inventory.manage', async (req, res, tenant) => {
    const {requestId, expectedRevision, quantity:quantityInput, reason} = req.body || {};
    const amount=quantityAmountSafe(quantityInput);
    if (!uuid.test(req.params.id) || typeof requestId !== 'string' || !uuid.test(requestId) ||
        amount===null || typeof expectedRevision !== 'string' || !/^\d{1,20}$/.test(expectedRevision) || typeof reason !== 'string' ||
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
      const [[unit]]=await db.query(`SELECT base_unit_code AS baseUnitCode,base_unit_label AS baseUnitLabel,base_unit_label_ar AS baseUnitLabelAr,
        quantity_precision AS quantityPrecision,CAST(quantity_increment AS CHAR) AS quantityIncrement,revision,updated_by_identity_id AS updatedByIdentityId
        FROM sx_retail_product_inventory_units WHERE tenant_id=? AND product_id=? FOR UPDATE`,[tenant,product.id]);
      const precisionValue=Number(unit?.quantityPrecision||0),increment=quantity.scaled(unit?.quantityIncrement||'1.000000'),unitRevision=Number(unit?.revision||0);
      if(!quantity.atPrecision(amount,precisionValue)||!quantity.isMultiple(amount,increment)){await db.rollback();return res.sendStatus(400);}
      const key = [tenant, product.id,location.id];
      const [[prior]] = await db.query(
        'SELECT CAST(quantity AS CHAR) AS quantity, previous_revision AS previousRevision, reason FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=? AND request_id=?',
        [...key, requestId.toLowerCase()]);
      if (prior) {
        await db.rollback();
        if (quantity.scaled(prior.quantity)!==amount || prior.previousRevision !== expectedRevision || prior.reason !== reason.trim()) return res.sendStatus(409);
        return res.json({success: true, data: {...prior,quantity:quantity.json(amount,precisionValue)}});
      }
      const [[latest]] = await db.query(
        'SELECT CAST(quantity AS CHAR) AS quantity, CAST(id AS CHAR) AS revision FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=? ORDER BY id DESC LIMIT 1', key);
      if ((latest?.revision ?? '0') !== expectedRevision) {
        await db.rollback();
        return res.status(409).json({success: false, code: 'STOCK_CHANGED'});
      }
      const [[reserved]]=await db.query(
        'SELECT COALESCE(SUM(quantity),0) AS quantity FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? AND location_id=?',key);
      const reservedAmount=quantity.scaled(reserved.quantity||'0')||0n;
      if (amount < reservedAmount) {
        await db.rollback();
        return res.status(409).json({success:false,code:'STOCK_RESERVED'});
      }
      await ensureUnitVersion(db,tenant,product.id,unit,req.businessContext.identity.id);
      await db.query(
        'INSERT INTO sx_business_stock_movements (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_unit_revision,unit_revision,previous_quantity,quantity,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [...key, requestId.toLowerCase(), req.businessContext.identity.id, expectedRevision,unitRevision,unitRevision, latest?.quantity ?? '0.000000', quantity.fixed(amount), reason.trim()]);
      await inventoryAlerts.evaluate(db,tenant,product.id,location.id);
      await db.commit();
      res.json({success: true, data: {quantity:quantity.json(amount,precisionValue)}});
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  }));
  return router;
};
