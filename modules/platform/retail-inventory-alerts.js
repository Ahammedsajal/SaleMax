'use strict';

const crypto=require('node:crypto');
const quantity=require('./retail-quantity');

function safeText(value,max=120){
  return String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

function inventoryAlertText(data){
  const code=safeText(data.productCode,40)||String(data.productId||'').slice(0,8).toUpperCase();
  const nameEn=safeText(data.nameEn)||code,nameAr=safeText(data.nameAr)||nameEn;
  const locationEn=safeText(data.locationNameEn)||safeText(data.locationCode,40)||'Location';
  const locationAr=safeText(data.locationNameAr)||locationEn;
  const unitEn=safeText(data.baseUnitLabel)||({yard:'yard',piece:'piece',panel:'panel',unit:'unit'}[data.baseUnitCode]||'unit');
  const unitAr=safeText(data.baseUnitLabelAr)||({yard:'ياردة',piece:'قطعة',panel:'لوح',unit:'وحدة'}[data.baseUnitCode]||unitEn);
  const precision=Number(data.quantityPrecision||0),available=quantity.format(quantity.scaled(data.availableQuantity),precision),threshold=quantity.format(quantity.scaled(data.threshold),precision);
  if(data.state==='low')return `Low stock · ${code} · ${nameEn}\nLocation: ${locationEn}\nAvailable: ${available} ${unitEn} · Threshold: ${threshold}\n\nمخزون منخفض · ${code} · ${nameAr}\nالموقع: ${locationAr}\nالمتاح: ${available} ${unitAr} · الحد: ${threshold}`;
  return `Back in stock · ${code} · ${nameEn}\nLocation: ${locationEn}\nAvailable: ${available} ${unitEn}\n\nعاد المخزون · ${code} · ${nameAr}\nالموقع: ${locationAr}\nالمتاح: ${available} ${unitAr}`;
}

async function snapshot(db,tenantId,productId,locationId){
  const [[row]]=await db.query(`SELECT p.id AS productId,p.code AS productCode,p.name_en AS nameEn,p.name_ar AS nameAr,
      l.code AS locationCode,l.name_en AS locationNameEn,l.name_ar AS locationNameAr,
      COALESCE(u.base_unit_code,'unit') AS baseUnitCode,COALESCE(u.base_unit_label,'') AS baseUnitLabel,
      COALESCE(u.base_unit_label_ar,'') AS baseUnitLabelAr,COALESCE(u.quantity_precision,0) AS quantityPrecision,
      CAST(COALESCE((SELECT m.quantity FROM sx_business_stock_movements m
        WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id AND m.location_id=l.id ORDER BY m.id DESC LIMIT 1),0) AS CHAR) AS onHand,
      CAST(COALESCE((SELECT SUM(r.quantity) FROM sx_retail_stock_reservations r
        WHERE r.tenant_id=p.tenant_id AND r.product_id=p.id AND r.location_id=l.id),0) AS CHAR) AS reserved,
      CAST(t.low_stock_threshold AS CHAR) AS threshold
    FROM sx_product_catalog p JOIN sx_retail_locations l ON l.tenant_id=p.tenant_id AND l.id=? AND l.status='active'
    JOIN sx_retail_inventory_location_thresholds t ON t.tenant_id=p.tenant_id AND t.product_id=p.id AND t.location_id=l.id
    LEFT JOIN sx_retail_product_inventory_units u ON u.tenant_id=p.tenant_id AND u.product_id=p.id
    WHERE p.tenant_id=? AND p.id=? AND p.deleted_at IS NULL AND p.status<>'retired'`,[locationId,tenantId,productId]);
  if(!row||row.threshold===null)return row?{...row,state:'unknown',availableQuantity:null}:null;
  const onHand=quantity.scaled(row.onHand),reserved=quantity.scaled(row.reserved),threshold=quantity.scaled(row.threshold);
  if(onHand===null||reserved===null||threshold===null)return {...row,state:'unknown',availableQuantity:null};
  const available=onHand>reserved?onHand-reserved:0n;
  return {...row,state:available<=threshold?'low':'healthy',availableQuantity:quantity.fixed(available)};
}

async function emit(db,tenantId,data,revision){
  const outbox=require('./business-notifications');
  const state=data.state;
  const eventKey=`retail-inventory:${data.productId}:${data.locationId}:${revision}:${state}`;
  await outbox.enqueue(db,tenantId,{kind:'retail_inventory_event',sourceType:'retail_inventory_alert',sourceId:data.productId,key:eventKey,
    payload:{...data,transitionRevision:revision}});
}

async function evaluate(db,tenantId,productId,locationId){
  const data=await snapshot(db,tenantId,productId,locationId);
  if(!data)return {tracked:false};
  const [[settings]]=await db.query('SELECT enabled,retail_inventory_enabled AS inventoryEnabled FROM sx_business_notification_settings WHERE tenant_id=?',[tenantId]);
  const canNotify=Number(settings?.enabled)===1&&Number(settings?.inventoryEnabled)===1;
  let [[state]]=await db.query(`SELECT observed_state AS observedState,notified_state AS notifiedState,transition_revision AS transitionRevision
    FROM sx_retail_inventory_alert_states WHERE tenant_id=? AND product_id=? AND location_id=? FOR UPDATE`,[tenantId,productId,locationId]);
  if(!state){
    const observed=data.state;
    const notified=observed==='healthy'?'healthy':'unknown';
    await db.query(`INSERT INTO sx_retail_inventory_alert_states
      (tenant_id,product_id,location_id,observed_state,notified_state,available_quantity,low_stock_threshold)
      VALUES (?,?,?,?,?,?,?)`,[tenantId,productId,locationId,observed,notified,data.availableQuantity,data.threshold]);
    state={observedState:observed,notifiedState:notified,transitionRevision:0};
  }else{
    await db.query(`UPDATE sx_retail_inventory_alert_states SET observed_state=?,available_quantity=?,low_stock_threshold=?
      ,notified_state=IF(?='unknown','unknown',notified_state)
      WHERE tenant_id=? AND product_id=? AND location_id=?`,[data.state,data.availableQuantity,data.threshold,data.state,tenantId,productId,locationId]);
    state.observedState=data.state;
  }
  if(data.state==='unknown'||!canNotify||data.state===state.notifiedState)return {tracked:true,state:data.state,queued:false};
  const revision=Number(state.transitionRevision||0)+1;
  await emit(db,tenantId,data,revision);
  await db.query(`UPDATE sx_retail_inventory_alert_states SET notified_state=?,transition_revision=?
    WHERE tenant_id=? AND product_id=? AND location_id=?`,[data.state,revision,tenantId,productId,locationId]);
  return {tracked:true,state:data.state,queued:true,revision};
}

async function scanTenant(db,tenantId){
  const [rows]=await db.query(`SELECT t.product_id AS productId,t.location_id AS locationId
    FROM sx_retail_inventory_location_thresholds t JOIN sx_product_catalog p
      ON p.tenant_id=t.tenant_id AND p.id=t.product_id AND p.deleted_at IS NULL AND p.status<>'retired'
    JOIN sx_retail_locations l ON l.tenant_id=t.tenant_id AND l.id=t.location_id AND l.status='active'
    WHERE t.tenant_id=? AND t.low_stock_threshold IS NOT NULL ORDER BY t.product_id,t.location_id`,[tenantId]);
  let queued=0;
  for(const row of rows){const result=await evaluate(db,tenantId,row.productId,row.locationId);if(result.queued)queued++;}
  return {evaluated:rows.length,queued};
}

module.exports={safeText,inventoryAlertText,snapshot,evaluate,scanTenant};
