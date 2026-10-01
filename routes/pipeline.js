const router = require("express").Router();
const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise.js");
const pipeline = require("../helper/pipeline/leadPipeline.js");
const pipelineAccess = require("../helper/pipeline/access.js");
const pipelineReports = require("../helper/pipeline/reports.js");

function fail(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("Pipeline request failed:", error?.code || error?.name || "unknown");
  return res.status(status).json({ success: false, message: status >= 500 ? "Pipeline request failed." : error.message });
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
      "SELECT uid, role, timezone FROM user WHERE email = ? AND password = ? LIMIT 1",
      [decoded.email, decoded.password],
    );
    if (users.length && users[0].role === "user") {
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

router.get("/settings", async (req, res) => {
  try {
    const data = await pipeline.getSettings(req.pipelineActor.uid);
    res.json({ success: true, data: { ...data, timezone: req.pipelineActor.timezone, role: req.pipelineActor.role } });
  } catch (error) { fail(res, error); }
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

router.get("/leads/:id", authorizeLead, (req, res) => {
  res.json({ success: true, data: req.pipelineLead });
});

router.get("/leads/:id/activity", authorizeLead, (req, res) => {
  res.json({ success: true, data: req.pipelineLead.activities || [] });
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
