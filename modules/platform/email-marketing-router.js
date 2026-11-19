'use strict';

const service=require('./email-marketing');

function createEmailMarketingRouter({pool:injectedPool,authenticate,origin,key}={}){
  const express=require('express'),router=express.Router(),pool=injectedPool||require('../../database/config').promise();
  router.use(authenticate||((req,res)=>res.status(401).json({success:false,code:'AUTH_REQUIRED'})));
  router.use(express.json({limit:'128kb',strict:true}));
  const run=fn=>async(req,res)=>{
    let db;
    try{
      db=await pool.getConnection();
      const ctx=await service.sessionContext(db,req.featureSession);
      res.set('Cache-Control','no-store');
      res.json({success:true,...await fn(db,ctx,req)});
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:500;
      res.status(status).json({success:false,code:status>=500?(error?.code||'EMAIL_MARKETING_UNAVAILABLE'):(error?.code||'INVALID_REQUEST')});
    }finally{db?.release();}
  };

  router.get('/setup',run(async(db,ctx)=>service.setup(db,ctx,key)));
  router.post('/domains',run(async(db,ctx,req)=>service.addDomain(db,ctx,req.body,key)));
  router.post('/domains/:id/refresh',run(async(db,ctx,req)=>service.refreshDomain(db,ctx,req.params.id,key)));
  router.delete('/domains/:id',run(async(db,ctx,req)=>service.deleteDomain(db,ctx,req.params.id)));
  router.post('/domains/:id/replies',run(async(db,ctx,req)=>service.enableReplies(db,ctx,req.params.id,key)));
  router.post('/domains/:id/replies/refresh',run(async(db,ctx,req)=>service.refreshReplies(db,ctx,req.params.id,key)));
  router.post('/senders',run(async(db,ctx,req)=>service.addSender(db,ctx,req.body,key)));
  router.post('/senders/:id/refresh',run(async(db,ctx,req)=>service.refreshSender(db,ctx,req.params.id,key)));
  router.post('/senders/:id/test',run(async(db,ctx,req)=>{
    const result=await service.testSend(db,ctx,{senderId:req.params.id,recipient:req.body?.recipient},key);
    const [local,domain]=result.recipient.split('@');
    await service.audit(db,ctx,'email.sender.test-sent','email-sender',req.params.id,{recipient:`${local.slice(0,1)}***@${domain}`});
    return result;
  }));
  router.post('/attachments',express.raw({type:'application/octet-stream',limit:service.MAX_ATTACHMENT_BYTES}),run(async(db,ctx,req)=>{
    if(!Buffer.isBuffer(req.body))throw Object.assign(Error('INVALID_ATTACHMENT'),{code:'INVALID_ATTACHMENT',status:400});
    return service.saveAttachment(db,ctx,{fileName:req.query.filename,buffer:req.body});
  }));
  router.get('/attachments/:id/preview',async(req,res)=>{
    let db;
    try{
      db=await pool.getConnection();
      const ctx=await service.sessionContext(db,req.featureSession);
      const image=await service.previewAttachment(db,ctx,req.params.id);
      res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
        'Cross-Origin-Resource-Policy':'same-site',
        'Content-Security-Policy':"default-src 'none'; sandbox"});
      res.type(image.contentType).send(image.content);
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:500;
      res.status(status).json({success:false,code:status>=500?(error?.code||'EMAIL_MARKETING_UNAVAILABLE'):(error?.code||'INVALID_REQUEST')});
    }finally{db?.release();}
  });
  router.get('/templates',run(async(db,ctx)=>({items:await service.listTemplates(db,ctx)})));
  router.post('/templates',run(async(db,ctx,req)=>service.saveTemplate(db,ctx,req.body)));
  router.put('/templates/:id',run(async(db,ctx,req)=>service.saveTemplate(db,ctx,req.body,req.params.id)));
  router.post('/audience/preview',run(async(db,ctx,req)=>service.previewAudience(db,ctx,req.body,key)));
  router.get('/campaigns',run(async(db,ctx)=>({items:await service.listCampaigns(db,ctx)})));
  router.get('/analytics',run(async(db,ctx,req)=>service.analytics(db,ctx,req.query?.days)));
  router.post('/campaigns',run(async(db,ctx,req)=>service.createCampaign(db,ctx,req.body,key)));
  router.get('/campaigns/:id',run(async(db,ctx,req)=>service.campaignDetail(db,ctx,req.params.id)));
  router.get('/inbox',run(async(db,ctx)=>service.inbox(db,ctx)));
  router.get('/inbox/:id/messages',run(async(db,ctx,req)=>service.threadMessages(db,ctx,req.params.id)));
  router.use((req,res)=>res.status(404).json({success:false,code:'EMAIL_ROUTE_NOT_FOUND'}));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const tooLarge=error?.type==='entity.too.large';
    res.status(tooLarge?413:400).json({success:false,code:tooLarge?'ATTACHMENT_SIZE_INVALID':'INVALID_REQUEST'});
  });
  return router;
}

function createPublicEmailRouter({pool:injectedPool,key,topicArn=process.env.SALEMAX_EMAIL_SES_SNS_TOPIC_ARN}={}){
  const express=require('express'),router=express.Router(),pool=injectedPool||require('../../database/config').promise();
  router.use(express.urlencoded({extended:false,limit:'8kb'}));
  const tokenOf=req=>String(req.params.token||'');
  router.post('/ses/inbound',express.raw({type:'*/*',limit:require('./email-marketing-sns').MAX_SNS_BODY_BYTES}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const sns=require('./email-marketing-sns'),inbound=require('./email-marketing-inbound');
      const settings=require('./email-marketing-provider-settings');
      const topic=await settings.inboundSnsTopic(pool);if(!topic)throw Object.assign(Error('SES_INBOUND_PROVIDER_NOT_CONFIGURED'),{code:'SES_INBOUND_PROVIDER_NOT_CONFIGURED',status:503});
      const parsed=await sns.parseAndVerify(req.body,topic);
      if(parsed.type==='SubscriptionConfirmation'){
        if(parsed.confirmation?.confirmed)await settings.markInboundSubscriptionConfirmed(pool,topic);
        return res.status(200).json({accepted:true,confirmed:parsed.confirmation?.confirmed===true});
      }
      if(parsed.type==='Notification')return res.status(200).json(await inbound.persistReceived(pool,parsed,key));
      return res.status(200).json({accepted:true,ignored:true});
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:500;
      res.status(status).json({success:false,code:status>=500?'SES_INBOUND_UNAVAILABLE':(error?.code||'SNS_MESSAGE_INVALID')});
    }
  });
  router.post('/ses/events',express.raw({type:'*/*',limit:require('./email-marketing-sns').MAX_SNS_BODY_BYTES}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const sns=require('./email-marketing-sns'),events=require('./email-marketing-events');
      const settings=require('./email-marketing-provider-settings');
      const currentTopic=await settings.snsTopic(pool)||topicArn;
      const parsed=await sns.parseAndVerify(req.body,currentTopic);
      if(parsed.type==='Notification')return res.status(200).json(await events.persist(pool,parsed));
      return res.status(200).json({accepted:true,confirmed:parsed.confirmation?.confirmed===true,ignored:parsed.ignored===true});
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:500;
      return res.status(status).json({success:false,code:status>=500?'SES_EVENT_UNAVAILABLE':(error?.code||'SNS_MESSAGE_INVALID')});
    }
  });
  router.get('/unsubscribe/:token',(req,res)=>{
    res.set({'Cache-Control':'no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font:16px system-ui;max-width:34rem;margin:12vh auto;padding:1.5rem;color:#172033"><h1>Unsubscribe from marketing email</h1><p>Confirm to stop marketing emails to this address.</p><form method="post"><button style="padding:.8rem 1.1rem;font:inherit">Unsubscribe</button></form></body></html>`);
  });
  router.post('/unsubscribe/:token',async(req,res)=>{
    let db;
    try{
      db=await pool.getConnection();await service.applyUnsubscribe(db,key,tokenOf(req));
      res.set({'Cache-Control':'no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
      if(String(req.get('List-Unsubscribe')||'').toLowerCase()==='one-click'||req.body?.['List-Unsubscribe']==='One-Click')return res.status(200).json({success:true,unsubscribed:true});
      return res.type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font:16px system-ui;max-width:34rem;margin:12vh auto;padding:1.5rem;color:#172033"><h1>You are unsubscribed</h1><p>No more marketing email will be sent to this address.</p></body></html>');
    }catch(error){res.status(Number.isInteger(error?.status)?error.status:500).type('text').send('Unable to update email preferences.');}
    finally{db?.release();}
  });
  return router;
}

module.exports={createEmailMarketingRouter,createPublicEmailRouter};
