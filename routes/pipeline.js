const router = require("express").Router();
const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise.js");
const pipeline = require("../helper/pipeline/leadPipeline.js");
const pipelineAccess = require("../helper/pipeline/access.js");
const pipelineReports = require("../helper/pipeline/reports.js");
const trainingCourses = require('../modules/platform/training-courses');
const saleReviews = require('../modules/platform/training-sale-reviews');
const reportSchedules = require('../modules/platform/training-report-schedules');
const trainingForms = require('../modules/platform/training-forms');
const legacyPipelineActor = require('../modules/platform/legacy-pipeline-actor');

async function saleContext(actor) {
  const ctx=await trainingCourses.legacyOwnerContext(require('../database/config.js').promise(),actor.uid);
  if(actor.role==='manager'){
    ctx.identity={id:actor.identityId};
    ctx.membership={...ctx.membership,role:'manager',id:actor.membershipId,delegatedPermissions:[]};
  }else{
    ctx.membership={...ctx.membership,role:actor.role,id:actor.role==='agent'?`legacy-agent-${actor.agentId}`:ctx.membership.id,delegatedPermissions:[]};
  }
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
        if(linkedActor?.role==='manager'){
          req.pipelineActor=linkedActor;
          return next();
        }
      }
      req.pipelineActor = { uid: users[0].uid, role: "owner", actorType: "user", actorId: String(users[0].uid), timezone: users[0].timezone || "Asia/Qatar" };
      return next();
    }

    const agents = await query(
      "SELECT id, uid, owner_uid, role, is_active FROM agents WHERE email = ? AND password = ? LIMIT 1",
      [decoded.email, decoded.password],
    );
    const agent = agents[0];
    if (!agent || agent.role !== "agent" || Number(agent.is_active) !== 1) {
      return res.status(403).json({ success: false, message: "You do not have access to this pipeline." });
    }
    const owners = await query("SELECT uid, timezone FROM user WHERE uid = ? LIMIT 1", [agent.owner_uid]);
    if (!owners.length) return res.status(403).json({ success: false, message: "The agent workspace could not be found." });
    req.pipelineActor = { uid: owners[0].uid, role: "agent", actorType: "agent", actorId: String(agent.id), agentId: Number(agent.id), timezone: owners[0].timezone || "Asia/Qatar" };
    req.pipelineActor.agentUid = agent.uid;
    return next();
  } catch (error) {
    return fail(res, error);
  }
}

router.use(pipelineAuth);

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

router.post('/training-forms/:formSlug/submissions', async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  const receivedOrigin=req.get('Origin')||'';const expectedOrigin=process.env.SALEMAX_PLATFORM_ORIGIN;
  let sameHost=false;try{sameHost=new URL(receivedOrigin).host.toLowerCase()===(req.get('host')||'').toLowerCase();}catch{}
  if(!receivedOrigin||(expectedOrigin?receivedOrigin!==expectedOrigin:!sameHost))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['submissionToken','values'].includes(key)))return res.status(400).json({success:false,code:'INVALID_SUBMISSION'});
  if(Buffer.byteLength(JSON.stringify(req.body),'utf8')>16*1024)return res.status(413).json({success:false,code:'PAYLOAD_TOO_LARGE'});
  try {
    const data=await trainingForms.submitStaff(require('../database/config.js').promise(),req.pipelineActor,req.params.formSlug,req.body);
    res.status(data.repeated?200:201).json({success:true,data});
  } catch(error) {
    const code=error.code||'STAFF_FORM_UNAVAILABLE';
    const status=code==='FORM_NOT_FOUND'?404:code==='PERMISSION_DENIED'?403:['INVALID_SUBMISSION','INVALID_PHONE','INVALID_EMAIL','INVALID_COURSE','INVALID_PREFERRED_DATE','REQUIRED_FIELD_MISSING','CONSENT_REQUIRED'].includes(code)?400:['CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:code==='BUSINESS_LINK_INVALID'?409:500;
    res.status(status).json({success:false,code:status===500?'STAFF_FORM_UNAVAILABLE':code});
  }
});

router.get("/board", async (req, res) => {
  try {
    const data = await pipeline.getBoard({
      uid: req.pipelineActor.uid,
      role: req.pipelineActor.role,
      agentId: req.pipelineActor.agentId,
      filters: {
        search: req.query.search,
        stage: req.query.stage,
        origin: req.query.origin,
        sourceType: req.query.sourceType,
        owner: req.query.owner,
        page: req.query.page,
        limit: req.query.limit,
      },
    });
    res.json({ success: true, data: { ...data, timezone: req.pipelineActor.timezone, role: req.pipelineActor.role } });
  } catch (error) { fail(res, error); }
});

router.get("/follow-ups", async (req, res) => {
  try {
    const data = await pipeline.getFollowUps({
      uid: req.pipelineActor.uid, role: req.pipelineActor.role, agentId: req.pipelineActor.agentId,
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
    res.json({ success: true, data: { ...data, timezone: req.pipelineActor.timezone, role: req.pipelineActor.role } });
  } catch (error) { fail(res, error); }
});

router.get("/contacts/matches", async (req, res) => {
  try {
    const data = await pipeline.findContactMatches({
      uid: req.pipelineActor.uid, role: req.pipelineActor.role, agentId: req.pipelineActor.agentId,
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

router.get("/reports/activity", async (req,res)=>{
  try{
    const data=await pipelineReports.getActivityReport({
      pool:require("../database/config.js").promise(),uid:req.pipelineActor.uid,
      role:req.pipelineActor.role,agentId:req.pipelineActor.agentId,
      period:req.query.period,at:req.query.at,timezone:req.pipelineActor.timezone,
      page:req.query.page===undefined?1:Number(req.query.page),limit:req.query.limit===undefined?50:Number(req.query.limit),
    });
    res.setHeader('Cache-Control','no-store');res.json({success:true,data});
  }catch(error){fail(res,error);}
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
router.post('/reports/schedules/:scheduleId/runs/:runId/revisions',async(req,res)=>{
  if(req.pipelineActor.role!=='owner')return res.status(403).json({success:false,code:'PERMISSION_DENIED'});
  try{const ctx=await saleContext(req.pipelineActor),db=await require('../database/config.js').promise().getConnection();let data;try{data=await reportSchedules.reviseRun(db,ctx,{...req.body,scheduleId:req.params.scheduleId,runId:req.params.runId});}finally{db.release();}res.setHeader('Cache-Control','no-store');res.status(data.repeated?200:202).json({success:true,data});}
  catch(error){reportScheduleError(res,error);}
});
function reportScheduleError(res,error){
  const code=error?.code||'REPORT_SCHEDULE_UNAVAILABLE';
  const status=code==='PERMISSION_DENIED'?403:code==='FEATURE_UNAVAILABLE'||code==='CATEGORY_UNAVAILABLE'||code==='ACCOUNT_INACTIVE'||code==='STALE_REPORT_SCHEDULE'||code==='STALE_REPORT_REVISION'||code==='REPORT_RUN_NOT_REVISIONABLE'||code==='IDEMPOTENCY_CONFLICT'?409:code==='REPORT_RUN_NOT_FOUND'?404:code.startsWith('INVALID_')||code==='REPORT_CHANNEL_REQUIRED'?400:503;
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
      role: req.pipelineActor.role,
      input: req.body || {},
    });
    res.status(201).json({ success: true, data });
  } catch (error) { fail(res, error); }
});

async function authorizeLead(req, res, next) {
  try {
    const lead = await pipeline.getLead(req.pipelineActor.uid, req.params.id,{role:req.pipelineActor.role,agentId:req.pipelineActor.agentId});
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
  try{if(req.pipelineActor.role!=='owner')return res.status(403).json({success:false,code:'PERMISSION_DENIED'});const ctx=await saleContext(req.pipelineActor);const conversion=require('../modules/platform/training-sale-conversion'),db=await require('../database/config.js').promise().getConnection();let data;try{data=await conversion.convert(db,ctx,{uid:req.pipelineActor.uid,leadId:req.params.id,saleReviewId:req.params.reviewId,requestKey:req.body?.requestKey,actorRole:req.pipelineActor.role});}finally{db.release();}res.status(data.repeated?200:201).json({success:true,data});}
  catch(error){fail(res,error);}
});

router.patch("/leads/:id", authorizeLead, async (req, res) => {
  try {
    const data = await pipeline.updateLead({
      uid: req.pipelineActor.uid,
      id: req.params.id,
      input: req.body || {},
      actorType: req.pipelineActor.actorType,
      actorId: req.pipelineActor.actorId,
      role: req.pipelineActor.role,
      agentId: req.pipelineActor.agentId,
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
    });
    res.json({ success: true, data });
  } catch (error) { fail(res, error); }
});

module.exports = router;
