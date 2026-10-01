'use strict';
const crypto=require('node:crypto');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const state=user=>hash(JSON.stringify([user.plan==null?null:String(user.plan),user.plan_expire==null?null:String(user.plan_expire)]));
function input(body,actorUid) {
  if(!body || typeof body!=='object' || Array.isArray(body))fail('INVALID_ASSIGNMENT');
  const uid=body.uid, raw=body.plan?.id;
  if(typeof uid!=='string' || !uid.trim() || uid!==uid.trim() || uid.length>999 ||
     !['number','string'].includes(typeof raw) || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw)<1 || Number(raw)>2147483647)fail('INVALID_ASSIGNMENT');
  if(typeof actorUid!=='string' || !actorUid || actorUid.length>999)fail('ADMIN_REQUIRED');
  const requestId=body.requestId===undefined?crypto.randomUUID():body.requestId;
  if(!uuid(requestId))fail('INVALID_REQUEST_ID');
  if(body.expectedState!==undefined && (typeof body.expectedState!=='string' || !/^[a-f0-9]{64}$/.test(body.expectedState)))fail('INVALID_EXPECTED_STATE');
  if(body.expectedPlanState!==undefined && (typeof body.expectedPlanState!=='string' || !/^[a-f0-9]{64}$/.test(body.expectedPlanState)))fail('INVALID_EXPECTED_STATE');
  return {uid,planId:Number(raw),actorUid,requestId:requestId.toLowerCase(),expectedState:body.expectedState,expectedPlanState:body.expectedPlanState};
}
async function assign(db,actorUid,body) {
  const data=input(body,actorUid);
  // Refuse to promise rollback/row locking against nontransactional tables.
  const [engines]=await db.query("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('user','plan','sx_legacy_plan_assignments')");
  if(engines.length!==3 || engines.some(row=>row.ENGINE!=='InnoDB'))fail('ASSIGNMENT_STORAGE_NOT_READY');
  await db.beginTransaction();
  try {
    const [users]=await db.query('SELECT id,uid,plan,plan_expire FROM user WHERE uid=? FOR UPDATE',[data.uid]);
    if(!users.length)fail('USER_NOT_FOUND');if(users.length!==1)fail('AMBIGUOUS_USER');
    const user=users[0];
    if(user.uid!==data.uid)fail('USER_NOT_FOUND');
    const [[previous]]=await db.query('SELECT owner_uid,actor_uid,plan_id,id,assigned_expiry FROM sx_legacy_plan_assignments WHERE request_id=?',[data.requestId]);
    if(previous) {
      if(previous.owner_uid!==data.uid || previous.actor_uid!==data.actorUid || Number(previous.plan_id)!==data.planId)fail('IDEMPOTENCY_CONFLICT');
      await db.commit();return {assignmentId:previous.id,expiresAt:Number(previous.assigned_expiry),replayed:true};
    }
    await require('./legacy-ownership-guard').requireUnmapped(db,user.id);
    if(data.expectedState && data.expectedState!==state(user))fail('STALE_ASSIGNMENT');
    const [[plan]]=await db.query('SELECT * FROM plan WHERE id=? FOR UPDATE',[data.planId]);
    if(!plan)fail('PLAN_NOT_FOUND');
    if(data.expectedPlanState && data.expectedPlanState!==hash(JSON.stringify(plan)))fail('STALE_PLAN');
    const days=Number(plan.plan_duration_in_days);
    if(!/^\d+$/.test(String(plan.plan_duration_in_days)) || !Number.isSafeInteger(days) || days<1 || days>365000)fail('INVALID_PLAN_DURATION');
    let expiresAt=Date.now()+days*86400000;
    // A repeated same-plan change within the same millisecond must still
    // invalidate a preview's state token for concurrent assignment attempts.
    if(String(user.plan_expire)===String(expiresAt))expiresAt+=1;
    const assignmentId=crypto.randomUUID(),snapshot=JSON.stringify(plan);
    await db.query(`INSERT INTO sx_legacy_plan_assignments(id,request_id,owner_uid,owner_uid_hash,actor_uid,plan_id,previous_snapshot,previous_expiry,assigned_snapshot,assigned_expiry) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [assignmentId,data.requestId,data.uid,hash(data.uid),data.actorUid,data.planId,user.plan,user.plan_expire,snapshot,expiresAt]);
    const [updated]=await db.query('UPDATE user SET plan=?,plan_expire=? WHERE id=?',[snapshot,expiresAt,user.id]);
    if(updated.affectedRows!==1)fail('ASSIGNMENT_WRITE_FAILED');
    await db.commit();return {assignmentId,expiresAt,replayed:false};
  } catch(error) {await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('IDEMPOTENCY_CONFLICT');throw error;}
}
const messages={INVALID_ASSIGNMENT:'Choose a valid user and plan.',ADMIN_REQUIRED:'Administrator sign-in is required.',INVALID_REQUEST_ID:'Invalid assignment request. Reload and try again.',INVALID_EXPECTED_STATE:'Invalid assignment state. Reload and try again.',USER_NOT_FOUND:'User not found. Refresh the user list.',AMBIGUOUS_USER:'This user identifier is duplicated. Resolve it before assigning a plan.',PLAN_NOT_FOUND:'Plan not found. Refresh the catalogue.',INVALID_PLAN_DURATION:'This plan has an invalid duration. Correct the plan first.',STALE_ASSIGNMENT:'This user’s plan changed. Refresh before assigning.',STALE_PLAN:'This catalogue plan changed. Review it again before assigning.',IDEMPOTENCY_CONFLICT:'This request was already used for a different assignment.',ASSIGNMENT_STORAGE_NOT_READY:'Plan assignment storage is not ready. Contact the administrator.'};
function createHandler(pool,afterCommit=async()=>{},reportError=()=>{}) {
  return async(req,res)=>{
    let db;
    try {
      input(req.body,req.decode?.uid);
      db=await pool.getConnection();
      const result=await assign(db,req.decode.uid,req.body);
      db.release();db=null;
      if(!result.replayed) {
        try {await afterCommit(req.body.uid);}
        catch(_) {reportError({code:'ASSIGNMENT_SYNC_FAILED'});}
      }
      return res.json({success:true,msg:'User plan was updated',...result});
    } catch(error) {
      if(!messages[error.code])reportError({code:error.code||'ASSIGNMENT_FAILED'});
      return res.json({success:false,code:messages[error.code]?error.code:'ASSIGNMENT_FAILED',msg:messages[error.code]||'Could not assign the plan. Please try again.'});
    } finally {db?.release();}
  };
}
function summary(raw) {
  let plan;
  try {plan=typeof raw==='string'?JSON.parse(raw):raw;}catch(_){return {valid:false,plan:null};}
  if(plan==null)return {valid:true,plan:null};
  if(typeof plan!=='object' || Array.isArray(plan))return {valid:false,plan:null};
  const fields=['id','title','price','price_strike','is_trial','plan_duration_in_days','contact_limit','qr_account','allow_tag','allow_note','allow_chatbot','allow_api','wa_warmer','rest_api_qr'];
  return {valid:true,plan:Object.fromEntries(fields.filter(key=>['string','number','boolean'].includes(typeof plan[key])).map(key=>[key,plan[key]]))};
}
async function context(db,userId) {
  if(!['number','string'].includes(typeof userId) || !/^\d+$/.test(String(userId)) || !Number.isSafeInteger(Number(userId)) || Number(userId)<1)fail('INVALID_ASSIGNMENT');
  await db.beginTransaction();
  try {
    const [[user]]=await db.query('SELECT id,uid,name,plan,plan_expire FROM user WHERE id=?',[Number(userId)]);
    if(!user || typeof user.uid!=='string')fail('USER_NOT_FOUND');
    const [matches]=await db.query('SELECT id FROM user WHERE uid=?',[user.uid]);
    if(matches.length!==1)fail('AMBIGUOUS_USER');
    const [rows]=await db.query('SELECT id,assigned_snapshot,assigned_expiry,assigned_at FROM sx_legacy_plan_assignments WHERE owner_uid_hash=? AND owner_uid=? ORDER BY assigned_at DESC,id DESC LIMIT 20',[hash(user.uid),user.uid]);
    const result={userId:user.id,uid:user.uid,name:user.name,current:summary(user.plan),expiresAt:user.plan_expire,state:state(user),history:rows.map(row=>({id:row.id,plan:summary(row.assigned_snapshot).plan,expiresAt:Number(row.assigned_expiry),assignedAt:row.assigned_at}))};
    await db.commit();return result;
  } catch(error) {await db.rollback();throw error;}
}
async function preview(db,actorUid,body) {
  const data=input(body,actorUid);
  await db.beginTransaction();
  try {
    const [users]=await db.query('SELECT id,uid,plan,plan_expire FROM user WHERE uid=?',[data.uid]);
    if(!users.length || users[0].uid!==data.uid)fail('USER_NOT_FOUND');if(users.length!==1)fail('AMBIGUOUS_USER');
    const user=users[0];if(data.expectedState && data.expectedState!==state(user))fail('STALE_ASSIGNMENT');
    const [[plan]]=await db.query('SELECT * FROM plan WHERE id=?',[data.planId]);if(!plan)fail('PLAN_NOT_FOUND');
    const days=Number(plan.plan_duration_in_days);if(!/^\d+$/.test(String(plan.plan_duration_in_days)) || !Number.isSafeInteger(days) || days<1 || days>365000)fail('INVALID_PLAN_DURATION');
    const result={state:state(user),planState:hash(JSON.stringify(plan)),current:summary(user.plan),selected:summary(plan).plan,currentExpiresAt:user.plan_expire,durationDays:days,expiryStartsAt:'confirmation',readOnly:true};
    await db.commit();return result;
  }catch(error){await db.rollback();throw error;}
}
function createReadHandler(pool,mode) {
  return async(req,res)=>{
    let db;
    try {
      if(!req.decode?.uid)fail('ADMIN_REQUIRED');
      db=await pool.getConnection();
      const data=mode==='context'?await context(db,req.query.userId):await preview(db,req.decode.uid,req.body);
      res.setHeader('Cache-Control','no-store');return res.json({success:true,data});
    }catch(error){return res.json({success:false,code:messages[error.code]?error.code:'ASSIGNMENT_READ_FAILED',msg:messages[error.code]||'Could not load assignment details. Please try again.'});}
    finally{db?.release();}
  };
}
module.exports={input,state,assign,createHandler,summary,context,preview,createReadHandler};
