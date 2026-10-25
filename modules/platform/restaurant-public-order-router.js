'use strict';
const express=require('express');
const crypto=require('node:crypto');
const restaurant=require('./restaurant-orders');
const domains=require('./tenant-crm-domains');
const origin=require('./request-origin');

function createRouter({pool,key}){
  const router=express.Router();
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!req.crmTenantDomain||!origin.matches(req))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});next();});
  router.use(express.json({limit:'16kb',strict:true}));
  async function withDb(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  async function brand(req){return withDb(db=>domains.publicBrand(db,req.crmTenantDomain.hostname));}
  async function rateLimit(req){
    const raw=String(req.get('X-Forwarded-For')||'').split(',').at(-1)?.trim(),remote=req.socket.remoteAddress||'unknown',trusted=/^(?:127\.|::1$|::ffff:127\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(remote),visitor=trusted&&require('node:net').isIP(raw||'')?raw:remote;
    const hash=crypto.createHmac('sha256',key).update(`${req.crmTenantDomain.tenantId}\0${visitor}`).digest('hex');
    return withDb(async db=>{await db.beginTransaction();try{const window=Math.floor(Date.now()/3600000);await db.query('INSERT INTO sx_website_rate_limits(visitor_hash,window_start,requests) VALUES (?,?,1) ON DUPLICATE KEY UPDATE requests=requests+1',[hash,window]);const [[row]]=await db.query('SELECT requests FROM sx_website_rate_limits WHERE visitor_hash=? AND window_start=? FOR UPDATE',[hash,window]);if(Number(row?.requests)>8)throw Object.assign(Error('RESTAURANT_ORDER_RATE_LIMITED'),{code:'RESTAURANT_ORDER_RATE_LIMITED',status:429});await db.commit();}catch(error){await db.rollback();throw error;}});
  }
  router.get('/catalog',async(req,res,next)=>{try{const current=await brand(req);if(!current||current.categoryKey!=='restaurant_cafe'||!current.revision||current.content?.showRestaurantMenu!==true)return res.status(404).json({success:false,code:'RESTAURANT_CATALOG_NOT_AVAILABLE'});if(typeof req.query.branch!=='string')return res.status(400).json({success:false,code:'INVALID_BRANCH'});const data=await withDb(db=>restaurant.publicCatalog(db,current.tenantId,req.query.branch));if(!data)return res.status(404).json({success:false,code:'RESTAURANT_BRANCH_UNAVAILABLE'});return res.json({success:true,data:{...data,tenant:{name:current.name,slug:current.slug}}});}catch(error){return next(error);}});
  router.post('/',async(req,res,next)=>{try{const current=await brand(req);if(!current||current.categoryKey!=='restaurant_cafe'||!current.revision||current.content?.showRestaurantMenu!==true)return res.status(404).json({success:false,code:'RESTAURANT_CATALOG_NOT_AVAILABLE'});await rateLimit(req);const data=await withDb(db=>restaurant.requestOrder(db,current.tenantId,req.body));return res.status(data.repeated?200:201).json({success:true,data});}catch(error){return next(error);}});
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':error.code||'RESTAURANT_ORDER_UNAVAILABLE';const status=Number(error.status)||(error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:code==='ORIGIN_DENIED'?403:code==='RESTAURANT_ORDER_RATE_LIMITED'?429:['CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE','RESTAURANT_CATALOG_NOT_AVAILABLE','RESTAURANT_BRANCH_UNAVAILABLE','RESTAURANT_CLOSED','FULFILLMENT_UNAVAILABLE','RESTAURANT_ITEM_UNAVAILABLE','INVALID_MODIFIER_SELECTIONS','MIXED_CURRENCY_CART','ORDER_REQUEST_REPLAY_CONFLICT'].includes(code)?409:code==='RETURN_ACCESS_INVALID'?404:code.startsWith('INVALID_')||code.endsWith('_REQUIRED')?400:503);return res.status(status).json({success:false,code:status>=500?'RESTAURANT_ORDER_UNAVAILABLE':code});});
  return router;
}
module.exports={createRouter};
