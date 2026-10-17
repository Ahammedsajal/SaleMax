'use strict';
const express=require('express'),crypto=require('node:crypto'),access=require('./invoice-customer-access');
function createInvoiceCustomerRouter({pool,origin}){
  const router=express.Router(),windows=new Map();
  router.use((req,res,next)=>{
    res.set({'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    if(req.get('Origin')&&!require('./request-origin').matches(req,origin))return res.status(403).json({code:'ORIGIN_DENIED'});
    // The app may see a shared reverse-proxy IP. Limit each capability too,
    // without trusting forwarded headers or retaining the raw capability.
    const now=Date.now(),token=req.get('x-invoice-access'),validShape=/^[A-Za-z0-9_-]{43}$/.test(token||'');
    const keys=[['ip:'+req.ip,600],[validShape?'token:'+crypto.createHash('sha256').update(token).digest('hex'):'invalid:'+req.ip,60]];
    if(windows.size>=10000)for(const [key,row] of windows)if(row.until<=now)windows.delete(key);
    for(const [key,limit] of keys){
      if(!windows.has(key)&&windows.size>=10000)return res.status(429).json({code:'TRY_AGAIN_LATER'});
      const old=windows.get(key),entry=old&&old.until>now?old:{until:now+60000,count:0};windows.set(key,entry);
      if(++entry.count>limit)return res.status(429).set('Retry-After','60').json({code:'TRY_AGAIN_LATER'});
    }
    next();
  });
  router.use(express.json({limit:'1kb',strict:true}));
  const run=fn=>async(req,res)=>{let db;try{db=await pool.getConnection();res.json({success:true,data:await fn(db,req)});}catch(error){const missing=error.code==='CUSTOMER_INVOICE_LINK_UNAVAILABLE';res.status(missing?404:503).json({success:false,code:missing?error.code:'CUSTOMER_INVOICE_UNAVAILABLE'});}finally{db?.release();}};
  router.get('/',run(async(db,req)=>access.view((await access.resolve(db,req.get('x-invoice-access'))).record)));
  router.put('/preferences',(req,res,next)=>{
    if(!require('./request-origin').matches(req,origin))return res.status(403).json({code:'ORIGIN_DENIED'});
    if(!req.body||typeof req.body.enabled!=='boolean'||Object.keys(req.body).some(k=>k!=='enabled'))return res.status(400).json({code:'INVALID_REMINDER_PREFERENCE'});next();
  },run((db,req)=>access.preferences(db,req.get('x-invoice-access'),req.body.enabled)));
  return router;
}
module.exports={createInvoiceCustomerRouter};
