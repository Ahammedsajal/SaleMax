const router = require("express").Router();
const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise.js");
const pipeline = require("../helper/pipeline/leadPipeline.js");
const salesLeadImport = require('../modules/platform/sales-lead-import');
const pipelineAccess = require("../helper/pipeline/access.js");
const pipelineReports = require("../helper/pipeline/reports.js");
const trainingCourses = require('../modules/platform/training-courses');
const saleReviews = require('../modules/platform/training-sale-reviews');
const reportSchedules = require('../modules/platform/training-report-schedules');
const reportDelivery = require('../modules/platform/training-report-delivery');
const trainingForms = require('../modules/platform/training-forms');
const legacyPipelineActor = require('../modules/platform/legacy-pipeline-actor');
const trainingLeadJourney = require('../modules/platform/training-lead-journey');
const leadFilters = require('../helper/pipeline/lead-filters');
const trainingTasks = require('../modules/platform/task-management');
const crypto = require('node:crypto');
const {createTaskRouter}=require('../modules/platform/task-router');

async function saleContext(actor) {
  if(actor.canonicalContext)return {...actor.canonicalContext,uid:actor.uid,uidHash:crypto.createHash('sha256').update(String(actor.uid),'utf8').digest('hex'),role:actor.role,actorType:actor.actorType,actorId:String(actor.actorId),agentId:actor.agentId,scopeAgentIds:actor.scopeAgentIds,scopeIdentityIds:actor.scopeIdentityIds};
  const ctx=await trainingCourses.legacyOwnerContext(require('../database/config.js').promise(),actor.uid);
  if(actor.role==='manager'){
    ctx.identity={id:actor.identityId};
    ctx.membership={...ctx.membership,role:'manager',id:actor.membershipId,delegatedPermissions:[]};
  }else{
    ctx.membership={...ctx.membership,role:actor.role,id:actor.role==='agent'?`legacy-agent-${actor.agentId}`:ctx.membership.id,delegatedPermissions:[]};
  }
  return ctx;
}

async function taskContext(actor,permission='tasks.read'){
  const pool=require('../database/config.js').promise();
  const agent=actor.role==='agent';
  const [rows]=agent
    ? await pool.query('SELECT * FROM agents WHERE id=? AND owner_uid=? AND is_active=1 LIMIT 1',[actor.agentId,actor.uid])
    : await pool.query('SELECT * FROM user WHERE uid=? LIMIT 1',[actor.legacyUid||actor.uid]);
  if(!rows.length)throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED',status:401});
  // Reload current grants for legacy and canonical actors through the shared loader.
  const context=await require('../modules/platform/business-feature-session').legacyContext(pool,rows[0],agent);
  if(!context)throw Object.assign(Error('VERIFIED_BUSINESS_OWNER_REQUIRED'),{code:'VERIFIED_BUSINESS_OWNER_REQUIRED',status:403});
  const ctx=await require('../modules/platform/training-task-context').createTaskContext(pool,{...context,scopeAgentIds:actor.scopeAgentIds,scopeIdentityIds:actor.scopeIdentityIds},permission);
  if(ctx.uid!==actor.uid)throw Object.assign(Error('BUSINESS_LINK_INVALID'),{code:'BUSINESS_LINK_INVALID',status:409});
  return ctx;
}

function fail(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("Pipeline request failed:", error?.code || error?.name || "unknown");
  return res.status(status).json({ success: false, ...(error.code ? { code: error.code } : {}), message: status >= 500 ? "Pipeline request failed." : error.message });
}

async function pipelineAuth(req, res, next) {
  try {
    const header = req.get("Authorization") || "";
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return res.status(401).json({ success: false, message: "Sign in to access the pipeline." });
    let decoded;
    try { decoded = jwt.verify(token, process.env.JWTKEY); }
    catch (_) { return res.status(401).json({ success: false, message: "Your session has expired." }); }

    const users = await query(
      "SELECT id, uid, name, email, role, timezone FROM user WHERE email = ? AND password = ? LIMIT 1",
      [decoded.email, decoded.password],
    );
    if (users.length && users[0].role === "user") {
      if(process.env.SALEMAX_PLATFORM_ENABLED==='true'){
        const linkedActor=await legacyPipelineActor.resolve(require('../database/config.js').promise(),users[0]);
        if(linkedActor?.denied)return res.status(linkedActor.code==='AUTH_REQUIRED'?401:403).json({success:false,code:linkedActor.code});
        if(legacyPipelineActor.canUsePipeline(linkedActor)){
          req.pipelineActor=linkedActor;
          return next();
        }
      }
      req.pipelineActor = { uid: users[0].uid, role: "owner", actorType: "user", actorId: String(users[0].uid), timezone: users[0].timezone || "Asia/Qatar" };
      return next();
    }

    const agents = await query(
      "SELECT id, uid, owner_uid, email, role, is_active FROM agents WHERE email = ? AND password = ? LIMIT 1",
      [decoded.email, decoded.password],
    );
    const agent = agents[0];
    if (!agent || agent.role !== "agent" || Number(agent.is_active) !== 1) {
      return res.status(403).json({ success: false, message: "You do not have access to this pipeline." });
    }
    const owners = await query("SELECT uid, timezone FROM user WHERE uid = ? LIMIT 1", [agent.owner_uid]);
    if (!owners.length) return res.status(403).json({ success: false, message: "The agent workspace could not be found." });
    if(process.env.SALEMAX_PLATFORM_ENABLED==='true'){
      const linkedAgent=await legacyPipelineActor.resolveAgent(require('../database/config.js').promise(),agent);
      if(linkedAgent?.denied)return res.status(403).json({success:false,code:linkedAgent.code});
      if(linkedAgent?.canonicalContext){
        req.pipelineActor=linkedAgent;
        return next();
      }
    }
    req.pipelineActor = { uid: owners[0].uid, role: "agent", actorType: "agent", actorId: String(agent.id), agentId: Number(agent.id), timezone: owners[0].timezone || "Asia/Qatar" };
    req.pipelineActor.agentUid = agent.uid;
    return next();
  } catch (error) {
    return fail(res, error);
  }
}

router.use(pipelineAuth);
router.use(async(req,res,next)=>{
 if(req.pipelineActor?.role!=='agent')return next();
 try{
  const [rows]=await require('../database/config').promise().query('SELECT * FROM agents WHERE id=?',[req.pipelineActor.agentId]);
  const session=await require('../modules/platform/business-feature-session').resolve(require('../database/config').promise(),{actor:rows[0],agent:true});
  require('../modules/platform/agent-workspace-access').authorize(req,session);
  req.pipelineActor.canonicalContext=session.context;req.pipelineActor.identityId=session.context.identity.id;req.pipelineActor.membershipId=session.context.membership.id;
  next();
 }catch(error){res.status(error.status||403).json({success:false,code:error.code||'PERMISSION_DENIED'});}
});
const openingRouting=require('../helper/pipeline/openingRouting');
const openingPool=require('../database/config').promise();
async function openingDb(work){const db=await openingPool.getConnection();try{return await work(db);}finally{db.release();}}
const openingAdmin=(req,res,next)=>req.pipelineActor.role==='owner'||req.pipelineActor.role==='manager'&&!Array.isArray(req.pipelineActor.scopeAgentIds)?next():res.status(403).json({success:false,message:'Your role cannot configure workspace-wide keyword routing.'});
router.get('/opening-routing',openingAdmin,async(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json({success:true,data:await openingDb(db=>openingRouting.list(db,req.pipelineActor.uid))});}catch(error){fail(res,error);}});
router.post('/opening-routing',openingAdmin,async(req,res)=>{try{res.status(201).json({success:true,data:await openingDb(db=>openingRouting.save(db,req.pipelineActor.uid,req.body))});}catch(error){fail(res,error);}});
router.put('/opening-routing/:id',openingAdmin,async(req,res)=>{try{res.json({success:true,data:await openingDb(db=>openingRouting.save(db,req.pipelineActor.uid,req.body,req.params.id))});}catch(error){fail(res,error);}});
router.delete('/opening-routing/:id',openingAdmin,async(req,res)=>{try{res.json({success:true,data:await openingDb(db=>openingRouting.remove(db,req.pipelineActor.uid,req.params.id,req.body?.expectedRevision))});}catch(error){fail(res,error);}});
router.get('/routing-notifications',async(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json({success:true,data:req.pipelineActor.role==='agent'?await openingDb(db=>openingRouting.notifications(db,req.pipelineActor.uid,req.pipelineActor.agentId)):{items:[]}});}catch(error){fail(res,error);}});
router.post('/routing-notifications/:id/read',async(req,res)=>{if(req.pipelineActor.role!=='agent')return res.status(403).json({success:false});try{res.json({success:true,data:await openingDb(db=>openingRouting.acknowledge(db,req.pipelineActor.uid,req.pipelineActor.agentId,req.params.id))});}catch(error){fail(res,error);}});
router.use('/tasks',createTaskRouter({pool:require('../database/config.js').promise(),contextFor:(req,permission)=>taskContext(req.pipelineActor,permission)}));

router.get('/training-forms', async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  try { const data=await trainingForms.staffForms(require('../database/config.js').promise(),req.pipelineActor);res.json({success:true,data}); }
  catch(error) { const code=error.code||'STAFF_FORM_UNAVAILABLE';const status=code==='PERMISSION_DENIED'?403:['CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)||code==='BUSINESS_LINK_INVALID'?409:500;res.status(status).json({success:false,code:status===500?'STAFF_FORM_UNAVAILABLE':code}); }
});

router.get('/training-forms/:formSlug', async (req,res) => {
  try {
    const data=await trainingForms.staffForm(require('../database/config.js').promise(),req.pipelineActor,req.params.formSlug);
    res.setHeader('Cache-Control','no-store');res.json({success:true,data});
  } catch(error) {
    const code=error.code||'STAFF_FORM_UNAVAILABLE';
    const status=['FORM_NOT_FOUND','INVALID_FORM_SLUG'].includes(code)?404:code==='PERMISSION_DENIED'?403:['CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)||code==='BUSINESS_LINK_INVALID'?409:500;
    res.setHeader('Cache-Control','no-store');res.status(status).json({success:false,code:status===500?'STAFF_FORM_UNAVAILABLE':code});
  }
});

router.get('/training-forms/:formSlug/leads', async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  try {
    const data=await trainingForms.searchStaffLeads(require('../database/config.js').promise(),req.pipelineActor,req.query.search);
    res.json({success:true,data});
  } catch(error) {
    const code=error.code||'STAFF_FORM_UNAVAILABLE';
    const status=code==='PERMISSION_DENIED'?403:code==='SEARCH_TERM_TOO_SHORT'?400:['CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:500;
    if(status>=500)console.error('Staff lead lookup failed:',code);
    res.status(status).json({success:false,code:status===500?'STAFF_FORM_UNAVAILABLE':code});
  }
});

router.get('/training-forms/:formSlug/leads/:leadId', async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  try {
    await trainingForms.staffForm(require('../database/config.js').promise(),req.pipelineActor,req.params.formSlug);
    const data=await trainingForms.staffLead(require('../database/config.js').promise(),req.pipelineActor,req.params.leadId);
    res.json({success:true,data});
  } catch(error) {
    const code=error.code||'STAFF_FORM_UNAVAILABLE';const status=code==='PERMISSION_DENIED'||code==='LEAD_NOT_ACCESSIBLE'?403:code==='FORM_NOT_FOUND'?404:['CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:500;
    res.status(status).json({success:false,code:status===500?'STAFF_FORM_UNAVAILABLE':code});
  }
});

router.post('/training-forms/:formSlug/submissions', async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  const receivedOrigin=req.get('Origin')||'';const expectedOrigin=process.env.SALEMAX_PLATFORM_ORIGIN;
  let sameHost=false;try{sameHost=new URL(receivedOrigin).host.toLowerCase()===(req.get('host')||'').toLowerCase();}catch{}
  if(!receivedOrigin||(expectedOrigin?receivedOrigin!==expectedOrigin:!sameHost))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['submissionToken','values','selectedLeadId','expectedFormVersion'].includes(key)))return res.status(400).json({success:false,code:'INVALID_SUBMISSION'});
  if(Buffer.byteLength(JSON.stringify(req.body),'utf8')>96*1024)return res.status(413).json({success:false,code:'PAYLOAD_TOO_LARGE'});
  try {
    const data=await trainingForms.submitStaff(require('../database/config.js').promise(),req.pipelineActor,req.params.formSlug,req.body);
    res.status(data.repeated?200:201).json({success:true,data});
  } catch(error) {
    const code=error.code||'STAFF_FORM_UNAVAILABLE';
    const status=error.status|| (code==='FORM_NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:['INVALID_SUBMISSION','INVALID_PHONE','INVALID_EMAIL','INVALID_COURSE','INVALID_PREFERRED_DATE','REQUIRED_FIELD_MISSING','CONSENT_REQUIRED'].includes(code)?400:['CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:code==='BUSINESS_LINK_INVALID'||code==='LEAD_NOT_ACCESSIBLE'?409:500);
    res.status(status).json({success:false,code:status===500?'STAFF_FORM_UNAVAILABLE':code});
  }
});

router.get('/stage-summary',async(req,res)=>{
  try{
    const pool=require('../database/config.js').promise(),actor=req.pipelineActor;
    await trainingLeadJourney.reconcileExisting(pool,{uid:actor.uid});
    const uidHash=crypto.createHash('sha256').update(String(actor.uid),'utf8').digest('hex');
    const conditions=['l.uid_hash=?'],args=[uidHash];
    if(actor.role==='agent'){conditions.push('l.owner_agent_id=?');args.push(actor.agentId);}
    else if(['manager','team_leader'].includes(actor.role)&&Array.isArray(actor.scopeAgentIds)){
      if(actor.scopeAgentIds.length){conditions.push('l.owner_agent_id IN (?)');args.push(actor.scopeAgentIds);}
      else conditions.push('1=0');
    }
    const [rows]=await pool.query(`SELECT s.stage_key AS stageKey,s.title,s.position,COUNT(l.id) AS total
      FROM pipeline_stages s LEFT JOIN pipeline_leads l ON l.uid_hash=s.uid_hash AND l.stage_key=s.stage_key AND ${conditions.join(' AND ')}
      WHERE s.uid_hash=? GROUP BY s.stage_key,s.title,s.position ORDER BY s.position,s.stage_key`,[...args,uidHash]);
    const stages=rows.map(row=>({...row,total:Number(row.total||0)}));
    const data={stages,total:stages.reduce((sum,row)=>sum+row.total,0),timezone:actor.timezone,role:actor.role,categoryKey:actor.categoryKey||null};
    res.setHeader('Cache-Control','no-store');res.json({success:true,data});
  }catch(error){fail(res,error);}
});

router.get("/board", async (req, res) => {
  try {
    const pool=require('../database/config.js').promise();
    await trainingLeadJourney.reconcileExisting(pool,{uid:req.pipelineActor.uid});
    const data = await pipeline.getBoard({
      uid: req.pipelineActor.uid,
      role: req.pipelineActor.role,
      agentId: req.pipelineActor.agentId,
      scopeAgentIds: req.pipelineActor.scopeAgentIds,
      categoryKey: req.pipelineActor.categoryKey,
      timezone: req.pipelineActor.timezone,
      filters: {
        search: req.query.search,
        stage: req.query.stage,
        origin: req.query.origin,
        sourceType: req.query.sourceType,
        assignment: req.query.assignment,
        qrInstanceId: req.query.qrInstanceId,
        owner: req.query.owner,
        page: req.query.page,
        limit: req.query.limit,
      },
    });
    data.customFieldContract=await require('../modules/platform/lead-field-runtime').contractForOwner(pool,req.pipelineActor.uid);
    data.leadWorkspaceContract=await require('../modules/platform/lead-workspace-contract').forOwner(pool,req.pipelineActor.uid);
    res.setHeader('Cache-Control','private, no-store');
    res.json({ success: true, data: { ...data, timezone: req.pipelineActor.timezone, role: req.pipelineActor.role, categoryKey: req.pipelineActor.categoryKey || null } });
  } catch (error) { fail(res, error); }
});

router.get('/leads/export', async (req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    const actor=req.pipelineActor;
    const pool=require('../database/config.js').promise();
    await trainingLeadJourney.reconcileExisting(pool,{uid:actor.uid});
    const data=await pipeline.getBoard({uid:actor.uid,role:actor.role,agentId:actor.agentId,scopeAgentIds:actor.scopeAgentIds,categoryKey:actor.categoryKey,timezone:actor.timezone,includeQualificationData:true,filters:{
      search:req.query.search,stage:req.query.stage,origin:req.query.origin,sourceType:req.query.sourceType,assignment:req.query.assignment,
      qrInstanceId:req.query.qrInstanceId,owner:req.query.owner,page:1,limit:300,
    }});
    const csv=require('../modules/platform/pipeline-lead-export').toCsv(data.leads);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="salemax-pipeline-leads.csv"');
    return res.status(200).send(csv);
  }catch(error){return fail(res,error);}
});

router.get('/filter-options',async(req,res)=>{
  try{
    const actor=req.pipelineActor,uidHash=crypto.createHash('sha256').update(String(actor.uid),'utf8').digest('hex');
    const conditions=['l.uid_hash=?','l.uid=?','bc.origin="qr"'],args=[uidHash,actor.uid];
    if(actor.role==='agent'){conditions.push('l.owner_agent_id=?');args.push(actor.agentId);}
    else if(['manager','team_leader'].includes(actor.role)&&Array.isArray(actor.scopeAgentIds)){
      if(actor.scopeAgentIds.length){conditions.push('l.owner_agent_id IN (?)');args.push(actor.scopeAgentIds);}
      else conditions.push('1=0');
    }
    const [rows]=await require('../database/config.js').promise().query(`SELECT i.id,i.uniqueId,i.number,i.title,COUNT(DISTINCT l.id) AS leadCount
      FROM pipeline_leads l JOIN pipeline_conversations pc ON pc.uid_hash=l.uid_hash AND pc.lead_id=l.id
      JOIN beta_chats bc ON bc.uid=l.uid COLLATE utf8mb4_unicode_ci AND bc.chat_id=pc.chat_id COLLATE utf8mb4_unicode_ci AND bc.origin='qr'
      JOIN instance i ON i.uid=bc.uid AND i.uniqueId=bc.origin_instance_unique_id
      WHERE ${conditions.join(' AND ')} GROUP BY i.id,i.uniqueId,i.number,i.title ORDER BY i.number,i.id`,args);
    res.setHeader('Cache-Control','no-store');res.json({success:true,data:{qrInstances:rows.map(row=>({...row,id:Number(row.id),leadCount:Number(row.leadCount)}))}});
  }catch(error){fail(res,error);}
});

router.get("/follow-ups", async (req, res) => {
  try {
    const data = await pipeline.getFollowUps({
      uid: req.pipelineActor.uid, role: req.pipelineActor.role, agentId: req.pipelineActor.agentId, scopeAgentIds:req.pipelineActor.scopeAgentIds,
      period: req.query.period || "all", page: req.query.page === undefined ? 1 : Number(req.query.page),
      limit: req.query.limit === undefined ? 20 : Number(req.query.limit),
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: { ...data, timezone: req.pipelineActor.timezone } });
  } catch (error) { fail(res, error); }
});

router.get("/settings", async (req, res) => {
  try {
    const data = await pipeline.getSettings(req.pipelineActor.uid);
    res.json({ success: true, data: { ...data, timezone: req.pipelineActor.timezone, role: req.pipelineActor.role, categoryKey: req.pipelineActor.categoryKey || null } });
  } catch (error) { fail(res, error); }
});

router.get("/contacts/matches", async (req, res) => {
  try {
    const data = await pipeline.findContactMatches({
      uid: req.pipelineActor.uid, role: req.pipelineActor.role, agentId: req.pipelineActor.agentId, scopeAgentIds:req.pipelineActor.scopeAgentIds,
      phone: req.query.phone, email: req.query.email,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data });
  } catch (error) { fail(res, error); }
});

router.get('/sale-options',async(req,res)=>{
  try{const ctx=await saleContext(req.pipelineActor);res.setHeader('Cache-Control','no-store');res.json({success:true,data:await saleReviews.listOptions(require('../database/config.js').promise(),ctx)});}
  catch(error){fail(res,error);}
});

router.get('/course-options',async(req,res)=>{
  try{const ctx=await saleContext(req.pipelineActor);res.setHeader('Cache-Control','no-store');res.json({success:true,data:await trainingCourses.intakeOptions(require('../database/config.js').promise(),ctx)});}
  catch(error){fail(res,error);}
});

router.get("/reports/activity", async (req,res)=>{
  try{
    const data=await pipelineReports.getActivityReport({
      pool:require("../database/config.js").promise(),uid:req.pipelineActor.uid,
      role:req.pipelineActor.role,agentId:req.pipelineActor.agentId,scopeAgentIds:req.pipelineActor.scopeAgentIds,
      period:req.query.period,at:req.query.at,timezone:req.pipelineActor.timezone,
      page:req.query.page===undefined?1:Number(req.query.page),limit:req.query.limit===undefined?50:Number(req.query.limit),assignment:req.query.assignment,qrInstanceId:req.query.qrInstanceId,
    });
    res.setHeader('Cache-Control','no-store');res.json({success:true,data});
  }catch(error){fail(res,error);}
});

router.get('/reports/summary',async(req,res)=>{
  try{const data=await pipelineReports.getLeadReportSummary({pool:require('../database/config.js').promise(),uid:req.pipelineActor.uid,role:req.pipelineActor.role,agentId:req.pipelineActor.agentId,scopeAgentIds:req.pipelineActor.scopeAgentIds,from:req.query.from,to:req.query.to,timezone:req.pipelineActor.timezone,assignment:req.query.assignment,qrInstanceId:req.query.qrInstanceId});res.setHeader('Cache-Control','no-store');res.json({success:true,data});}
  catch(error){fail(res,error);}
});

router.get('/reports/leads',async(req,res)=>{
  try{const data=await pipelineReports.getReportLeads({pool:require('../database/config.js').promise(),uid:req.pipelineActor.uid,role:req.pipelineActor.role,agentId:req.pipelineActor.agentId,scopeAgentIds:req.pipelineActor.scopeAgentIds,kind:req.query.kind,date:req.query.date,from:req.query.from,to:req.query.to,selectedAgentId:req.query.agentId,timezone:req.pipelineActor.timezone,page:req.query.page===undefined?1:Number(req.query.page),limit:req.query.limit===undefined?50:Number(req.query.limit),assignment:req.query.assignment,qrInstanceId:req.query.qrInstanceId});res.setHeader('Cache-Control','no-store');res.json({success:true,data});}
  catch(error){fail(res,error);}
});

router.get('/reports/journey',async(req,res)=>{
  try{const pool=require('../database/config.js').promise();if(req.pipelineActor.categoryKey!=='salemax_sales')await trainingLeadJourney.reconcileExisting(pool,{uid:req.pipelineActor.uid});const data=await pipelineReports.getJourneyReport({pool,uid:req.pipelineActor.uid,role:req.pipelineActor.role,agentId:req.pipelineActor.agentId,scopeAgentIds:req.pipelineActor.scopeAgentIds,categoryKey:req.pipelineActor.categoryKey,period:req.query.period,at:req.query.at,timezone:req.pipelineActor.timezone,assignment:req.query.assignment,qrInstanceId:req.query.qrInstanceId});res.setHeader('Cache-Control','no-store');res.json({success:true,data});}
  catch(error){fail(res,error);}
});

router.get('/reports/schedules',async(req,res)=>{
  if(req.pipelineActor.role!=='owner')return res.status(403).json({success:false,code:'PERMISSION_DENIED'});
  try{const ctx=await saleContext(req.pipelineActor),db=await require('../database/config.js').promise().getConnection();let data;try{data=await reportSchedules.list(db,ctx);}finally{db.release();}res.setHeader('Cache-Control','no-store');res.json({success:true,data});}
  catch(error){reportScheduleError(res,error);}
});
router.put('/reports/schedules',async(req,res)=>{
  if(req.pipelineActor.role!=='owner')return res.status(403).json({success:false,code:'PERMISSION_DENIED'});
  try{const ctx=await saleContext(req.pipelineActor),db=await require('../database/config.js').promise().getConnection();let data;try{data=await reportSchedules.save(db,ctx,req.body);}finally{db.release();}res.setHeader('Cache-Control','no-store');res.json({success:true,data});}
  catch(error){reportScheduleError(res,error);}
});
router.post('/reports/schedules/:scheduleId/verifications',async(req,res)=>{
  if(req.pipelineActor.role!=='owner')return res.status(403).json({success:false,code:'PERMISSION_DENIED'});
  try{const ctx=await saleContext(req.pipelineActor),db=await require('../database/config.js').promise().getConnection();let data;try{data=await reportDelivery.requestVerification(db,ctx,{...req.body,scheduleId:req.params.scheduleId});}finally{db.release();}res.setHeader('Cache-Control','no-store');res.status(202).json({success:true,data});}
  catch(error){reportScheduleError(res,error);}
});
router.post('/reports/schedules/:scheduleId/verifications/:challengeId/confirm',async(req,res)=>{
  if(req.pipelineActor.role!=='owner')return res.status(403).json({success:false,code:'PERMISSION_DENIED'});
  try{const ctx=await saleContext(req.pipelineActor),db=await require('../database/config.js').promise().getConnection();let data;try{data=await reportDelivery.confirmVerification(db,ctx,{...req.body,scheduleId:req.params.scheduleId,challengeId:req.params.challengeId});}finally{db.release();}res.setHeader('Cache-Control','no-store');res.json({success:true,data});}
  catch(error){reportScheduleError(res,error);}
});
router.post('/reports/schedules/:scheduleId/runs/:runId/revisions',async(req,res)=>{
  if(req.pipelineActor.role!=='owner')return res.status(403).json({success:false,code:'PERMISSION_DENIED'});
  try{const ctx=await saleContext(req.pipelineActor),db=await require('../database/config.js').promise().getConnection();let data;try{data=await reportSchedules.reviseRun(db,ctx,{...req.body,scheduleId:req.params.scheduleId,runId:req.params.runId});}finally{db.release();}res.setHeader('Cache-Control','no-store');res.status(data.repeated?200:202).json({success:true,data});}
  catch(error){reportScheduleError(res,error);}
});
function reportScheduleError(res,error){
  const code=error?.code||'REPORT_SCHEDULE_UNAVAILABLE';
  const status=code==='PERMISSION_DENIED'?403:code==='REPORT_SCHEDULE_NOT_FOUND'||code==='REPORT_VERIFICATION_NOT_FOUND'||code==='REPORT_RUN_NOT_FOUND'?404:code==='REPORT_VERIFICATION_RATE_LIMIT'||code==='REPORT_VERIFICATION_COOLDOWN'?429:code==='FEATURE_UNAVAILABLE'||code==='CATEGORY_UNAVAILABLE'||code==='ACCOUNT_INACTIVE'||code==='STALE_REPORT_SCHEDULE'||code==='STALE_REPORT_REVISION'||code==='REPORT_RUN_NOT_REVISIONABLE'||code==='REPORT_DESTINATION_NOT_ENABLED'||code==='REPORT_EMAIL_NOT_CONFIGURED'||code==='REPORT_WHATSAPP_NOT_CONFIGURED'||code==='REPORT_VERIFICATION_NOT_CONFIGURED'||code==='REPORT_VERIFICATION_EXPIRED'||code==='REPORT_VERIFICATION_LOCKED'||code==='REPORT_VERIFICATION_NOT_ACTIVE'||code==='STALE_REPORT_VERIFICATION'||code==='IDEMPOTENCY_CONFLICT'?409:code==='REPORT_RUN_NOT_FOUND'?404:code==='REPORT_VERIFICATION_CODE_INVALID'||code==='REPORT_EMAIL_NOT_ACCEPTED'||code.startsWith('INVALID_')||code==='REPORT_CHANNEL_REQUIRED'?400:503;
  if(status>=500)console.error('Report schedule request failed:',code);
  return res.status(status).json({success:false,code:status===503?'REPORT_SCHEDULE_UNAVAILABLE':code});
}

router.put("/settings", async (req, res) => {
  if (req.pipelineActor.role !== "owner") return res.status(403).json({ success: false, message: "Only a workspace admin can configure pipeline automation." });
  try {
    const data = await pipeline.updateSettings(req.pipelineActor.uid, req.body || {});
    res.json({ success: true, data });
  } catch (error) { fail(res, error); }
});

router.post("/stages", async (req, res) => {
  if (req.pipelineActor.role !== "owner") return res.status(403).json({ success: false, message: "Only a workspace admin can manage stages." });
  try { res.status(201).json({ success: true, data: await pipeline.createStage(req.pipelineActor.uid, req.body || {}) }); }
  catch (error) { fail(res, error); }
});

router.put("/stages/order", async (req, res) => {
  if (req.pipelineActor.role !== "owner") return res.status(403).json({ success: false, message: "Only a workspace admin can manage stages." });
  try { await pipeline.reorderStages(req.pipelineActor.uid, req.body?.stageKeys); res.json({ success: true }); }
  catch (error) { fail(res, error); }
});

router.patch("/stages/:stageKey", async (req, res) => {
  if (req.pipelineActor.role !== "owner") return res.status(403).json({ success: false, message: "Only a workspace admin can manage stages." });
  try { res.json({ success: true, data: await pipeline.updateStage(req.pipelineActor.uid, req.params.stageKey, req.body || {}) }); }
  catch (error) { fail(res, error); }
});

router.delete("/stages/:stageKey", async (req, res) => {
  if (req.pipelineActor.role !== "owner") return res.status(403).json({ success: false, message: "Only a workspace admin can manage stages." });
  try { res.json({ success: true, data: await pipeline.deleteStage(req.pipelineActor.uid, req.params.stageKey, req.body?.targetStage) }); }
  catch (error) { fail(res, error); }
});

router.post("/leads", async (req, res) => {
  try {
    const data = await pipeline.createManualLead({
      uid: req.pipelineActor.uid,
      actorType: req.pipelineActor.actorType,
      actorId: req.pipelineActor.actorId,
      agentId: req.pipelineActor.agentId,
      scopeAgentIds:req.pipelineActor.scopeAgentIds,
      role: req.pipelineActor.role,
      input: {...(req.body || {}),sourceType:'manual'},
    });
    res.status(201).json({ success: true, data });
  } catch (error) { fail(res, error); }
});

// Internal SaleMaX Sales lead imports are intentionally restricted to the
// business owner. Validate the complete batch before writing, then create all
// rows in one transaction so a bad row cannot leave a partial import behind.
router.post('/leads/import', async (req,res) => {
  try{
    const pool=require('../database/config.js').promise();
    const data=await salesLeadImport.importBatch({pool,pipeline,actor:req.pipelineActor,rows:req.body?.rows});
    res.status(201).json({success:true,data});
  }catch(error){
    if(error.status)return res.status(error.status).json({success:false,code:error.code||'IMPORT_FAILED',...(error.row?{row:error.row}:{})});
    return fail(res,error);
  }
});

async function authorizeLead(req, res, next) {
  try {
    const lead = await pipeline.getLead(req.pipelineActor.uid, req.params.id,{role:req.pipelineActor.role,agentId:req.pipelineActor.agentId,scopeAgentIds:req.pipelineActor.scopeAgentIds});
    if(lead){
      const db=require('../database/config.js').promise();
      lead.customFieldContract=await require('../modules/platform/lead-field-runtime').contractForOwner(db,req.pipelineActor.uid);
      lead.leadWorkspaceContract=await require('../modules/platform/lead-workspace-contract').forOwner(db,req.pipelineActor.uid);
    }
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
    if (req.pipelineActor.role === "agent" && !pipelineAccess.canAgentAccessLead(req.pipelineActor.agentId, lead.owner_agent_id)) {
      return res.status(403).json({ success: false, message: "This lead is assigned to another agent." });
    }
    req.pipelineLead = lead;
    return next();
  } catch (error) { return fail(res, error); }
}

router.post("/leads/:id/follow-up/:action", authorizeLead, async (req, res) => {
  try {
    const data = await pipeline.resolveFollowUp({
      uid: req.pipelineActor.uid, id: req.params.id, action: req.params.action,
      at: req.body?.nextFollowUpAt, expectedDueAt: req.body?.expectedDueAt,
      actorType: req.pipelineActor.actorType, actorId: req.pipelineActor.actorId,
      role: req.pipelineActor.role, agentId: req.pipelineActor.agentId,
      scopeAgentIds:req.pipelineActor.scopeAgentIds,
    });
    res.json({ success: true, data });
  } catch (error) { fail(res, error); }
});

router.get("/leads/:id", authorizeLead, (req, res) => {
  res.json({ success: true, data: req.pipelineLead });
});

router.get("/leads/:id/activity", authorizeLead, (req, res) => {
  res.json({ success: true, data: req.pipelineLead.activities || [] });
});

router.get('/leads/:id/sale-reviews',authorizeLead,async(req,res)=>{
  try{const ctx=await saleContext(req.pipelineActor);res.setHeader('Cache-Control','no-store');res.json({success:true,data:await saleReviews.listForLead(require('../database/config.js').promise(),ctx,{leadId:req.params.id,uid:req.pipelineActor.uid,role:req.pipelineActor.role,agentId:req.pipelineActor.agentId})});}
  catch(error){fail(res,error);}
});

router.post('/leads/:id/sale-reviews',authorizeLead,async(req,res)=>{
  try{const ctx=await saleContext(req.pipelineActor);const data=await saleReviews.create(require('../database/config.js').promise(),ctx,{uid:req.pipelineActor.uid,leadId:req.params.id,role:req.pipelineActor.role,agentId:req.pipelineActor.agentId,actorType:req.pipelineActor.actorType,actorId:req.pipelineActor.actorId,input:req.body||{}});res.status(data.repeated?200:201).json({success:true,data});}
  catch(error){fail(res,error);}
});

router.post('/leads/:id/sale-reviews/:reviewId/decision',authorizeLead,async(req,res)=>{
  try{const ctx=await saleContext(req.pipelineActor);const data=await saleReviews.decide(require('../database/config.js').promise(),ctx,{uid:req.pipelineActor.uid,leadId:req.params.id,reviewId:req.params.reviewId,actorType:req.pipelineActor.actorType,actorRole:req.pipelineActor.role,actorId:req.pipelineActor.actorId,expectedRevision:req.body?.expectedRevision,decision:req.body?.decision,reason:req.body?.reason});res.json({success:true,data});}
  catch(error){fail(res,error);}
});

router.post('/leads/:id/sale-reviews/:reviewId/convert',authorizeLead,async(req,res)=>{
  try{if(!['owner','agent'].includes(req.pipelineActor.role))return res.status(403).json({success:false,code:'PERMISSION_DENIED'});const ctx=await saleContext(req.pipelineActor);const conversion=require('../modules/platform/training-sale-conversion'),db=await require('../database/config.js').promise().getConnection();let data;try{data=await conversion.convert(db,ctx,{uid:req.pipelineActor.uid,leadId:req.params.id,saleReviewId:req.params.reviewId,requestKey:req.body?.requestKey,actorRole:req.pipelineActor.role,actorType:req.pipelineActor.actorType==='agent'?'agent':'identity',actorId:String(req.pipelineActor.actorId)});}finally{db.release();}res.status(data.repeated?200:201).json({success:true,data});}
  catch(error){fail(res,error);}
});

router.patch("/leads/:id", authorizeLead, async (req, res) => {
  try {
    const pool=require('../database/config.js').promise();
    const input=req.body||{};
    const requestedOwner=input.ownerAgentId===undefined?undefined:(input.ownerAgentId===null||input.ownerAgentId===''?null:Number(input.ownerAgentId));
    const assignmentWillChange=requestedOwner!==undefined&&(requestedOwner===null?req.pipelineLead.owner_agent_id!=null:Number(req.pipelineLead.owner_agent_id)!==requestedOwner);
    const reminderContext=assignmentWillChange&&requestedOwner!==null
      ? await taskContext(req.pipelineActor,'tasks.manage') : null;
    const data = await pipeline.updateLead({
      uid: req.pipelineActor.uid,
      id: req.params.id,
      input,
      actorType: req.pipelineActor.actorType,
      actorId: req.pipelineActor.actorId,
      role: req.pipelineActor.role,
      agentId: req.pipelineActor.agentId,
      scopeAgentIds:req.pipelineActor.scopeAgentIds,
      categoryKey:req.pipelineActor.categoryKey,
      pool,
      onAssignmentChange: async (db,{lead,assignmentChange}) => {
        const chatIds=await db.query('SELECT DISTINCT chat_id FROM pipeline_conversations WHERE uid_hash=? AND lead_id=? AND chat_id IS NOT NULL AND chat_id<>\'\'',[require('crypto').createHash('sha256').update(String(req.pipelineActor.uid),'utf8').digest('hex'),lead.id]);
        const ids=(chatIds[0]||[]).map(row=>row.chat_id).filter(Boolean);
        if(!ids.length&&lead.chat_id)ids.push(lead.chat_id);
        const [agents]=assignmentChange.toAgentId===null?[[]]:await db.query('SELECT id,uid,name,email FROM agents WHERE id=? AND owner_uid=? AND is_active=1 LIMIT 1',[assignmentChange.toAgentId,req.pipelineActor.uid]);
        const [previousAgents]=assignmentChange.fromAgentId===null?[[]]:await db.query('SELECT uid FROM agents WHERE id=? AND owner_uid=? LIMIT 1',[assignmentChange.fromAgentId,req.pipelineActor.uid]);
        const previousUid=previousAgents[0]?.uid;
        const target=agents[0]||null;
        for(const chatId of ids){
          if(previousUid)await db.query('DELETE FROM agent_chats WHERE owner_uid=? AND uid=? AND chat_id=?',[req.pipelineActor.uid,previousUid,chatId]);
          if(target){
            await db.query('INSERT IGNORE INTO agent_chats(owner_uid,uid,chat_id) VALUES(?,?,?)',[req.pipelineActor.uid,target.uid,chatId]);
          }
          const [chatRows]=await db.query('SELECT assigned_agent FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1 FOR UPDATE',[req.pipelineActor.uid,chatId]);
          if(chatRows.length){
            let assigned=[];
            try{const parsed=typeof chatRows[0].assigned_agent==='string'?JSON.parse(chatRows[0].assigned_agent):chatRows[0].assigned_agent;assigned=Array.isArray(parsed)?parsed:parsed?[parsed]:[];}catch{}
            assigned=assigned.filter(item=>!previousUid||item?.uid!==previousUid);
            if(target&&!assigned.some(item=>String(item?.id)===String(target.id)||item?.uid===target.uid))assigned.push(target);
            await db.query('UPDATE beta_chats SET assigned_agent=? WHERE uid=? AND chat_id=?',[JSON.stringify(assigned),req.pipelineActor.uid,chatId]);
          }
        }
        let reminderTask=null;
        if(target){
          const dueAt=assignmentChange.followUpAt||new Date(Date.now()+60*60*1000).toISOString();
          const reminderInput={
            title:`Follow up: ${lead.title||lead.contact_name||'Lead'}`,
            description:`Follow up with ${lead.contact_name||lead.learner_name||lead.mobile||'this lead'}. The lead was assigned to you in Pipeline.`,
            taskType:'lead_follow_up',priority:lead.priority||'normal',dueAt,
            source:{type:'lead',id:lead.id},
            participants:[{actorType:'agent',actorId:String(target.id),role:'assignee'}],
          };
          const [existingReminders]=await db.query("SELECT id,revision FROM sx_tasks WHERE tenant_id=? AND uid_hash=? AND lead_id=? AND task_type='lead_follow_up' AND status IN ('open','in_progress','blocked') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[reminderContext.tenantId,reminderContext.uidHash,lead.id]);
          reminderTask=existingReminders.length
            ? await trainingTasks.edit(db,reminderContext,existingReminders[0].id,{...reminderInput,expectedRevision:Number(existingReminders[0].revision)},{manageTransaction:false})
            : await trainingTasks.create(db,reminderContext,reminderInput,{manageTransaction:false});
        }
        return { chatsAssigned:target?ids.length:0, reminderTaskId:reminderTask?.id||null };
      },
    });
    res.json({ success: true, data });
  } catch (error) { fail(res, error); }
});

router.post("/leads/:id/move", authorizeLead, async (req, res) => {
  try {
    const data = await pipeline.moveLead({
      uid: req.pipelineActor.uid,
      id: req.params.id,
      stageKey: req.body?.stageKey,
      actorType: req.pipelineActor.actorType,
      actorId: req.pipelineActor.actorId,
      role: req.pipelineActor.role,
      agentId: req.pipelineActor.agentId,
      scopeAgentIds:req.pipelineActor.scopeAgentIds,
    });
    res.json({ success: true, data });
  } catch (error) { fail(res, error); }
});

module.exports = router;
