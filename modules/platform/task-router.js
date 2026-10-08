'use strict';
const express=require('express');
const tasks=require('./task-management');

function createTaskRouter({pool,contextFor}){
  const router=express.Router();
  const withDb=async work=>{const db=await pool.getConnection();try{return await work(db);}finally{db.release();}};
  const run=(permission,work,successStatus=200)=>(req,res)=>Promise.resolve().then(async()=>{
    const ctx=await contextFor(req,permission);
    const data=await withDb(db=>work(db,ctx,req));
    res.setHeader('Cache-Control','no-store');res.status(successStatus).json({success:true,data});
  }).catch(error=>{
    const code=error?.code||'TASK_UNAVAILABLE';
    const status=Number(error?.status)||(['TASK_NOT_FOUND','TASK_LEAD_NOT_FOUND','TASK_PARTICIPANT_NOT_FOUND','TASK_MESSAGE_NOT_FOUND','TASK_SOURCE_NOT_FOUND'].includes(code)?404:['PERMISSION_DENIED'].includes(code)?403:['TASK_REVISION_CONFLICT','TASK_INVOICE_NOT_ACTIVE','TASK_INSTALLMENT_NOT_OPEN'].includes(code)?409:code.startsWith('INVALID_')||code.startsWith('DUPLICATE_')||code==='TASK_ASSIGNEE_REQUIRED'||code==='UNSUPPORTED_TASK_SOURCE'?400:503);
    if(status>=500)console.error('Task request failed:',code);
    res.status(status).json({success:false,code:status>=500?'TASK_UNAVAILABLE':code});
  });
  router.use(express.json({limit:'32kb',strict:true}));
  router.get('/',run('tasks.read',(db,ctx,req)=>tasks.list(db,ctx,{status:req.query.status||'all',scope:req.query.scope||'mine',page:req.query.page,limit:req.query.limit})));
  router.get('/participants',run('tasks.read',(db,ctx)=>tasks.listParticipants(db,ctx)));
  router.get('/source',run('tasks.manage',(db,ctx,req)=>tasks.sourceDetail(db,ctx,req.query.type,req.query.id)));
  router.get('/preferences',run('tasks.read',(db,ctx)=>tasks.getNotificationPreferences(db,ctx)));
  router.put('/preferences',run('tasks.read',(db,ctx,req)=>tasks.setNotificationPreferences(db,ctx,req.body||{})));
  router.post('/',run('tasks.manage',(db,ctx,req)=>tasks.create(db,ctx,req.body||{}),201));
  router.get('/:id/events',run('tasks.read',(db,ctx,req)=>tasks.eventHistory(db,ctx,req.params.id,{before:req.query.before,limit:req.query.limit})));
  router.get('/:id/notifications',run('tasks.read',(db,ctx,req)=>tasks.notificationHistory(db,ctx,req.params.id,{before:req.query.before,limit:req.query.limit})));
  router.get('/:id/messages',run('tasks.read',(db,ctx,req)=>tasks.messages(db,ctx,req.params.id,{after:req.query.after,before:req.query.before,latest:req.query.latest==='1',limit:req.query.limit})));
  router.get('/:id',run('tasks.read',(db,ctx,req)=>tasks.detail(db,ctx,req.params.id)));
  router.patch('/:id/status',run('tasks.manage',(db,ctx,req)=>tasks.updateStatus(db,ctx,req.params.id,req.body||{})));
  router.patch('/:id',run('tasks.manage',(db,ctx,req)=>tasks.edit(db,ctx,req.params.id,req.body||{})));
  router.delete('/:id',run('tasks.manage',(db,ctx,req)=>tasks.remove(db,ctx,req.params.id,req.body?.expectedRevision)));
  router.post('/:id/read',run('tasks.read',(db,ctx,req)=>tasks.markMessagesRead(db,ctx,req.params.id,req.body?.lastReadMessageId)));
  router.post('/:id/messages',run('tasks.manage',(db,ctx,req)=>tasks.addMessage(db,ctx,req.params.id,req.body?.body),201));
  return router;
}
module.exports={createTaskRouter};
