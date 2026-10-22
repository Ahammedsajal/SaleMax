'use strict';
const crypto=require('node:crypto');
const {salemaxSales,categoryKeyMatches}=require('./categories');
const {decision}=require('./policy');
const calculator=require('./sales-commission-calculator');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sha=value=>crypto.createHash('sha256').update(String(value),'utf8').digest('hex');
function assertCategory(ctx){if(ctx?.audience!=='tenant'||!categoryKeyMatches(ctx.category?.key,salemaxSales.key)||ctx.category?.version!==salemaxSales.version||!categoryKeyMatches(ctx.tenant?.categoryKey,salemaxSales.key)||Number(ctx.tenant?.categoryVersion)!==salemaxSales.version)fail('CATEGORY_UNAVAILABLE');if(!ctx.identity?.id||!ctx.membership?.id||ctx.membership.status!=='active')fail('PERMISSION_DENIED');}
function authorize(ctx,permission,resource){assertCategory(ctx);const access=decision(ctx,{capability:'sales.deals',permission,resource});if(!access.allowed)fail(access.code);}
async function audit(db,ctx,action,type,id,reason,changes){await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
  VALUES (?,?,?,'identity',?,?,?,?,?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,action,type,id,reason||null,JSON.stringify(changes||{}),crypto.randomUUID()]);}
async function ownerLegacy(db,tenantId){const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash AS uidHash FROM sx_legacy_ownership o
  JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
  JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
  WHERE o.tenant_id=? ORDER BY o.verified_at DESC LIMIT 2`,[tenantId]);if(owners.length!==1||owners[0].uidHash!==sha(owners[0].uid))fail('BUSINESS_LINK_INVALID');return owners[0];}
async function assignedLead(db,ctx,leadId,{lock=false}={}){
  if(!uuid(leadId))fail('INVALID_SALE_LEAD');
  const owner=await ownerLegacy(db,ctx.tenant.id);
  const [[lead]]=await db.query(`SELECT id,uid_hash AS uidHash,uid,owner_agent_id AS ownerAgentId,status,stage_key AS stageKey,currency,title
    FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=?${lock?' FOR UPDATE':''}`,[owner.uidHash,owner.uid,leadId]);
  if(!lead)fail('SALE_LEAD_NOT_FOUND');
  if(!Number.isSafeInteger(Number(lead.ownerAgentId))||Number(lead.ownerAgentId)<1)fail('SALE_LEAD_NOT_ASSIGNED');
  const [agents]=await db.query(`SELECT a.id,a.uid,o.legacy_uid_hash AS legacyUidHash,m.id AS membershipId,m.role,m.status AS membershipStatus,
      h.manager_membership_id AS managerMembershipId,h.team_leader_membership_id AS teamLeaderMembershipId
    FROM agents a JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=?
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='agent'
    LEFT JOIN sx_sales_org_history h ON h.tenant_id=m.tenant_id AND h.membership_id=m.id AND h.ended_at IS NULL
    WHERE a.id=? AND a.owner_uid=? AND a.is_active=1 LIMIT 2`,[ctx.tenant.id,lead.ownerAgentId,owner.uid]);
  if(agents.length!==1||agents[0].legacyUidHash!==sha(agents[0].uid)||agents[0].membershipStatus!=='active'||!agents[0].managerMembershipId||!agents[0].teamLeaderMembershipId)fail('SALE_LEAD_ASSIGNMENT_INVALID');
  const seller=agents[0];
  if(ctx.membership.role==='agent'&&seller.membershipId!==ctx.membership.id)fail('PERMISSION_DENIED');
  if(ctx.membership.role==='manager'&&seller.managerMembershipId!==ctx.membership.id)fail('PERMISSION_DENIED');
  if(ctx.membership.role==='team_leader'&&seller.teamLeaderMembershipId!==ctx.membership.id)fail('PERMISSION_DENIED');
  return {lead,seller,owner};
}
function cleanOptional(value,max){if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||value.trim().length>max)fail('INVALID_SALE_INPUT');return value.trim();}
function amountMinor(value){if((typeof value!=='string'&&typeof value!=='number')||!/^[1-9]\d{0,14}$/.test(String(value)))fail('INVALID_SALE_AMOUNT');return String(value);}
async function submit(db,ctx,input){
  authorize(ctx,'deals.request');
  if(!uuid(input?.idempotencyKey)||!uuid(input?.leadId)||!uuid(input?.productId))fail('INVALID_SALE_INPUT');
  const amount=amountMinor(input.amountMinor),currency=String(input.currency||'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))fail('INVALID_SALE_CURRENCY');
  const saleReference=cleanOptional(input.saleReference,191),sellerNote=cleanOptional(input.sellerNote,1000);
  await db.beginTransaction();
  try{
    const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [[repeat]]=await db.query(`SELECT id,lead_id AS leadId,product_id AS productId,amount_minor AS amountMinor,currency,status
      FROM sx_sales_deals WHERE tenant_id=? AND idempotency_key=? FOR UPDATE`,[ctx.tenant.id,input.idempotencyKey]);
    if(repeat){if(repeat.leadId!==input.leadId||repeat.productId!==input.productId||String(repeat.amountMinor)!==amount||repeat.currency!==currency)fail('IDEMPOTENCY_CONFLICT');await db.commit();return {...repeat,repeated:true};}
    const [[product]]=await db.query('SELECT id,name FROM sx_sales_products WHERE tenant_id=? AND id=? AND active=1 FOR UPDATE',[ctx.tenant.id,input.productId]);if(!product)fail('SALES_PRODUCT_UNAVAILABLE');
    const {lead,seller,owner}=await assignedLead(db,ctx,input.leadId,{lock:true});
    if(lead.status!=='open')fail('SALE_LEAD_NOT_OPEN');
    if(lead.currency!==currency)fail('SALE_CURRENCY_MISMATCH');
    const [[duplicate]]=await db.query(`SELECT id FROM sx_sales_deals WHERE tenant_id=? AND lead_id=? AND status IN ('pending_approval','approved') LIMIT 1 FOR UPDATE`,[ctx.tenant.id,lead.id]);if(duplicate)fail('SALE_ALREADY_REPORTED');
    const id=crypto.randomUUID();
    await db.query(`INSERT INTO sx_sales_deals(id,tenant_id,lead_uid_hash,lead_id,seller_membership_id,manager_membership_id,team_leader_membership_id,
      product_id,product_name_snapshot,amount_minor,currency,sale_reference,seller_note,status,idempotency_key,reported_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?,'pending_approval',?,?)`,[id,ctx.tenant.id,lead.uidHash,lead.id,seller.membershipId,seller.managerMembershipId,seller.teamLeaderMembershipId,product.id,product.name,amount,currency,saleReference,sellerNote,input.idempotencyKey,ctx.identity.id]);
    await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details)
      VALUES (?,?, 'user',?,'sale_submitted','Sale submitted for approval',?)`,[lead.uidHash,lead.id,ctx.identity.id,JSON.stringify({dealId:id,productId:product.id,amountMinor:amount,currency})]);
    await audit(db,ctx,'sales.deal.submitted','sales_deal',id,null,{leadId:lead.id,productId:product.id,amountMinor:amount,currency,sellerMembershipId:seller.membershipId,managerMembershipId:seller.managerMembershipId,teamLeaderMembershipId:seller.teamLeaderMembershipId,ownerUidHash:owner.uidHash});
    await db.commit();return {id,leadId:lead.id,productId:product.id,productName:product.name,amountMinor:amount,currency,status:'pending_approval',repeated:false};
  }catch(error){await db.rollback();throw error;}
}
function scopeSql(ctx,alias='d'){
  if(ctx.membership.role==='owner')return {sql:'',args:[]};
  if(ctx.membership.role==='manager')return {sql:` AND ${alias}.manager_membership_id=?`,args:[ctx.membership.id]};
  if(ctx.membership.role==='team_leader')return {sql:` AND ${alias}.team_leader_membership_id=?`,args:[ctx.membership.id]};
  if(ctx.membership.role==='agent')return {sql:` AND ${alias}.seller_membership_id=?`,args:[ctx.membership.id]};
  return {sql:' AND 1=0',args:[]};
}
async function listDeals(db,ctx,{status='all',limit=50}={}){
  authorize(ctx,'deals.read');if(!['all','pending_approval','approved','rejected','void'].includes(status))fail('INVALID_DEAL_FILTER');
  limit=Math.max(1,Math.min(100,Number(limit)||50));const scope=scopeSql(ctx),args=[ctx.tenant.id];let state='';if(status!=='all'){state=' AND d.status=?';args.push(status);}args.push(...scope.args,limit);
  const [items]=await db.query(`SELECT d.id,d.lead_id AS leadId,l.title AS leadTitle,d.product_id AS productId,d.product_name_snapshot AS productName,
      d.seller_membership_id AS sellerMembershipId,d.manager_membership_id AS managerMembershipId,d.team_leader_membership_id AS teamLeaderMembershipId,
      d.amount_minor AS amountMinor,d.currency,d.sale_reference AS saleReference,d.seller_note AS sellerNote,d.status,d.decision_reason AS decisionReason,
      d.submitted_at AS submittedAt,d.decided_at AS decidedAt,d.approved_by_identity_id AS approvedByIdentityId
    FROM sx_sales_deals d LEFT JOIN pipeline_leads l ON l.uid_hash=d.lead_uid_hash AND l.id=d.lead_id
    WHERE d.tenant_id=?${state}${scope.sql} ORDER BY d.submitted_at DESC,d.id LIMIT ?`,args);
  return {items,permissions:{canSubmit:['owner','manager','team_leader','agent'].includes(ctx.membership.role),canApprove:['owner','manager'].includes(ctx.membership.role)}};
}
async function dealForDecision(db,ctx,id,{lock=false}={}){
  if(!uuid(id))fail('INVALID_SALES_DEAL_ID');const [[deal]]=await db.query(`SELECT id,lead_uid_hash AS leadUidHash,lead_id AS leadId,seller_membership_id AS sellerMembershipId,
      manager_membership_id AS managerMembershipId,team_leader_membership_id AS teamLeaderMembershipId,product_id AS productId,product_name_snapshot AS productName,
      amount_minor AS amountMinor,currency,status FROM sx_sales_deals WHERE tenant_id=? AND id=?${lock?' FOR UPDATE':''}`,[ctx.tenant.id,id]);
  if(!deal)fail('SALES_DEAL_NOT_FOUND');if(ctx.membership.role==='manager'&&deal.managerMembershipId!==ctx.membership.id)fail('PERMISSION_DENIED');
  const ownerScopeContext={...ctx,membership:{...ctx.membership,role:'owner'}};
  const {lead,seller}=await assignedLead(db,ownerScopeContext,deal.leadId,{lock});if(seller.membershipId!==deal.sellerMembershipId)fail('SALE_LEAD_ASSIGNMENT_CHANGED');
  // The deal keeps the reporting path from submission even if the agent has
  // since moved. Commission attribution follows this immutable snapshot.
  return {deal,lead,seller:{...seller,managerMembershipId:deal.managerMembershipId,teamLeaderMembershipId:deal.teamLeaderMembershipId}};
}
async function decide(db,ctx,id,input){
  authorize(ctx,'deals.approve');const action=input?.decision,reason=cleanOptional(input?.reason,1000);if(!['approve','reject'].includes(action)||(action==='reject'&&(!reason||reason.length<3)))fail('INVALID_SALE_DECISION');
  await db.beginTransaction();try{
    const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const {deal,lead,seller}=await dealForDecision(db,ctx,id,{lock:true});if(deal.status!=='pending_approval')fail('SALES_DEAL_NOT_PENDING');
    if(action==='reject'){
      await db.query(`UPDATE sx_sales_deals SET status='rejected',approved_by_identity_id=?,decision_reason=?,decided_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='pending_approval'`,[ctx.identity.id,reason,ctx.tenant.id,id]);
      await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES(?,?, 'user',?,'sale_rejected','Sale submission rejected',?)`,[lead.uidHash,lead.id,ctx.identity.id,JSON.stringify({dealId:id,reason})]);
      await audit(db,ctx,'sales.deal.rejected','sales_deal',id,reason,{leadId:lead.id});await db.commit();return {id,status:'rejected'};
    }
    if(lead.status!=='open')fail('SALE_LEAD_NOT_OPEN');
    const [[policy]]=await db.query(`SELECT id FROM sx_sales_commission_policies WHERE tenant_id=? AND status='approved' LIMIT 1 FOR UPDATE`,[ctx.tenant.id]);if(!policy)fail('COMMISSION_POLICY_REQUIRED');
    const [[rate]]=await db.query(`SELECT agent_rate_bps AS agentRateBps,team_leader_rate_bps AS teamLeaderRateBps,manager_rate_bps AS managerRateBps
      FROM sx_sales_commission_policy_rates WHERE tenant_id=? AND policy_id=? AND product_id=?`,[ctx.tenant.id,policy.id,deal.productId]);if(!rate)fail('COMMISSION_PRODUCT_POLICY_REQUIRED');
    const rates={agent:Number(rate.agentRateBps),teamLeader:Number(rate.teamLeaderRateBps),manager:Number(rate.managerRateBps)};
    const calculation=calculator.calculate(String(deal.amountMinor),{agentRateBps:rates.agent,teamLeaderRateBps:rates.teamLeader,managerRateBps:rates.manager});
    for(const row of calculation.rows){if(row.amountMinor==='0')continue;const member=row.role==='agent'?seller.membershipId:row.role==='teamLeader'?seller.teamLeaderMembershipId:seller.managerMembershipId;
      await db.query(`INSERT INTO sx_sales_commissions(id,tenant_id,deal_id,policy_id,product_id,recipient_membership_id,recipient_role,rate_bps,basis_amount_minor,amount_minor,currency,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft')`,[crypto.randomUUID(),ctx.tenant.id,id,policy.id,deal.productId,member,row.role==='teamLeader'?'team_leader':row.role,row.rateBps,deal.amountMinor,row.amountMinor,deal.currency]);}
    const owner=await ownerLegacy(db,ctx.tenant.id);
    const [[wonStage]]=await db.query(`SELECT stage_key AS stageKey FROM pipeline_stages WHERE uid_hash=? AND uid=? AND stage_type='won' ORDER BY is_system DESC,position LIMIT 1 FOR UPDATE`,[lead.uidHash,owner.uid]);if(!wonStage)fail('WON_STAGE_NOT_CONFIGURED');
    await db.query(`UPDATE sx_sales_deals SET status='approved',commission_policy_id=?,approved_by_identity_id=?,decided_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='pending_approval'`,[policy.id,ctx.identity.id,ctx.tenant.id,id]);
    const [updated]=await db.query(`UPDATE pipeline_leads SET status='won',stage_key=?,stage_entered_at=UTC_TIMESTAMP(3),closed_at=UTC_TIMESTAMP(3),close_reason='sales_category_deal_approved',next_follow_up_at=NULL,last_activity_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
      WHERE uid_hash=? AND uid=? AND id=? AND status='open'`,[wonStage.stageKey,lead.uidHash,owner.uid,lead.id]);if(!updated.affectedRows)fail('SALE_LEAD_NOT_OPEN');
    await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES(?,?, 'user',?,'sale_approved','Sale approved and opportunity won',?)`,[lead.uidHash,lead.id,ctx.identity.id,JSON.stringify({dealId:id,productId:deal.productId,amountMinor:String(deal.amountMinor),currency:deal.currency,policyId:policy.id})]);
    await audit(db,ctx,'sales.deal.approved','sales_deal',id,null,{leadId:lead.id,productId:deal.productId,amountMinor:String(deal.amountMinor),currency:deal.currency,commissionPolicyId:policy.id,commissions:calculation.rows});
    await db.commit();return {id,status:'approved',commissionPolicyId:policy.id,commissionMinor:calculation.commissionMinor,currency:deal.currency};
  }catch(error){await db.rollback();throw error;}
}
async function listCommissions(db,ctx,{status='all',limit=100}={}){
  assertCategory(ctx);const access=decision(ctx,{capability:'sales.commissions',permission:'commissions.read'});if(!access.allowed)fail(access.code);
  if(!['all','draft','approved','paid','void'].includes(status))fail('INVALID_COMMISSION_FILTER');limit=Math.max(1,Math.min(200,Number(limit)||100));
  let scope='',scopeArgs=[ctx.tenant.id];if(ctx.membership.role==='manager'){scope=' AND d.manager_membership_id=?';scopeArgs.push(ctx.membership.id);}else if(ctx.membership.role==='team_leader'){scope=' AND d.team_leader_membership_id=?';scopeArgs.push(ctx.membership.id);}else if(ctx.membership.role==='agent'){scope=' AND c.recipient_membership_id=?';scopeArgs.push(ctx.membership.id);}
  const args=[...scopeArgs];
  let state='';if(status!=='all'){state=' AND c.status=?';args.push(status);}args.push(limit);
  const [items]=await db.query(`SELECT c.id,c.deal_id AS dealId,d.product_id AS productId,d.product_name_snapshot AS productName,d.lead_id AS leadId,
      c.recipient_membership_id AS recipientMembershipId,ri.display_name AS recipientName,c.recipient_role AS recipientRole,c.rate_bps AS rateBps,c.basis_amount_minor AS basisAmountMinor,
      c.amount_minor AS amountMinor,c.currency,c.status,c.approved_by_identity_id AS approvedByIdentityId,c.approved_at AS approvedAt,
      c.paid_by_identity_id AS paidByIdentityId,c.paid_at AS paidAt,c.payout_reference AS payoutReference,c.payout_batch_id AS payoutBatchId,p.version AS policyVersion
    FROM sx_sales_commissions c JOIN sx_sales_deals d ON d.tenant_id=c.tenant_id AND d.id=c.deal_id
    JOIN sx_sales_commission_policies p ON p.tenant_id=c.tenant_id AND p.id=c.policy_id
    JOIN sx_memberships rm ON rm.tenant_id=c.tenant_id AND rm.id=c.recipient_membership_id
    JOIN sx_identities ri ON ri.id=rm.identity_id
    WHERE c.tenant_id=?${scope}${state} ORDER BY (c.status='draft') DESC,c.paid_at DESC,c.id DESC LIMIT ?`,args);
  const [summaryByCurrency]=await db.query(`SELECT c.currency,
      COALESCE(SUM(CASE WHEN c.status='draft' THEN c.amount_minor ELSE 0 END),0) AS draftMinor,
      COALESCE(SUM(CASE WHEN c.status='approved' THEN c.amount_minor ELSE 0 END),0) AS approvedMinor,
      COALESCE(SUM(CASE WHEN c.status='paid' THEN c.amount_minor ELSE 0 END),0) AS paidMinor,
      SUM(c.status='draft') AS draftCount,SUM(c.status='approved') AS approvedCount,
      SUM(c.status='paid') AS paidCount,SUM(c.status='void') AS voidCount
    FROM sx_sales_commissions c JOIN sx_sales_deals d ON d.tenant_id=c.tenant_id AND d.id=c.deal_id
    WHERE c.tenant_id=?${scope} GROUP BY c.currency ORDER BY c.currency`,scopeArgs);
  return {items,summaryByCurrency,permissions:{canApprove:ctx.membership.role==='accountant',canPay:ctx.membership.role==='accountant'}};
}
async function commissionAction(db,ctx,id,action,input={}){
  if(action==='pay'){const batch=await createCommissionPayoutBatch(db,ctx,{commissionIds:[id],reference:input.reference});return {id,status:'paid',payoutBatchId:batch.id,reference:batch.reference,currency:batch.currency,totalMinor:batch.totalMinor,commissionCount:batch.commissionCount};}
  assertCategory(ctx);const permission=action==='approve'?'commission.payout.approve':'commission.payout.pay';const access=decision(ctx,{capability:'sales.commissions',permission});if(!access.allowed)fail(access.code);
  if(ctx.membership.role!=='accountant')fail('PERMISSION_DENIED');if(!uuid(id))fail('INVALID_COMMISSION_ID');
  const reference=action==='pay'?cleanOptional(input.reference,191):null;if(action==='pay'&&!reference)fail('PAYOUT_REFERENCE_REQUIRED');
  await db.beginTransaction();try{
    const [[row]]=await db.query(`SELECT id,status,approved_by_identity_id AS approvedByIdentityId FROM sx_sales_commissions WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,id]);if(!row)fail('COMMISSION_NOT_FOUND');
    if(action==='approve'){
      if(row.status!=='draft')fail('COMMISSION_NOT_DRAFT');
      await db.query(`UPDATE sx_sales_commissions SET status='approved',approved_by_identity_id=?,approved_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='draft'`,[ctx.identity.id,ctx.tenant.id,id]);
      await audit(db,ctx,'sales.commission.approved','sales_commission',id,null,{});
    }else{
      if(row.status!=='approved')fail('COMMISSION_NOT_APPROVED');if(row.approvedByIdentityId===ctx.identity.id)fail('PAYOUT_SEPARATION_REQUIRED');
      await db.query(`UPDATE sx_sales_commissions SET status='paid',paid_by_identity_id=?,paid_at=UTC_TIMESTAMP(3),payout_reference=? WHERE tenant_id=? AND id=? AND status='approved'`,[ctx.identity.id,reference,ctx.tenant.id,id]);
      await audit(db,ctx,'sales.commission.paid','sales_commission',id,null,{reference});
    }
    await db.commit();return {id,status:action==='approve'?'approved':'paid'};
  }catch(error){await db.rollback();throw error;}
}
async function createCommissionPayoutBatch(db,ctx,input={}){
  assertCategory(ctx);const access=decision(ctx,{capability:'sales.commissions',permission:'commission.payout.pay'});if(!access.allowed)fail(access.code);
  if(ctx.membership.role!=='accountant')fail('PERMISSION_DENIED');
  const rawIds=input.commissionIds;
  if(!Array.isArray(rawIds)||rawIds.length<1||rawIds.length>100||rawIds.some(id=>!uuid(id))||new Set(rawIds).size!==rawIds.length)fail('INVALID_PAYOUT_BATCH');
  const reference=cleanOptional(input.reference,191);if(!reference)fail('PAYOUT_REFERENCE_REQUIRED');
  const ids=[...rawIds].sort();
  await db.beginTransaction();
  try{
    const [rows]=await db.query(`SELECT id,status,currency,amount_minor AS amountMinor,approved_by_identity_id AS approvedByIdentityId
      FROM sx_sales_commissions WHERE tenant_id=? AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`,[ctx.tenant.id,...ids]);
    if(rows.length!==ids.length)fail('COMMISSION_NOT_FOUND');
    if(rows.some(row=>row.status!=='approved'))fail('COMMISSION_NOT_APPROVED');
    if(rows.some(row=>row.approvedByIdentityId===ctx.identity.id))fail('PAYOUT_SEPARATION_REQUIRED');
    const currencies=new Set(rows.map(row=>String(row.currency)));
    if(currencies.size!==1)fail('PAYOUT_BATCH_CURRENCY_MISMATCH');
    const [[existing]]=await db.query(`SELECT id FROM sx_sales_commission_payout_batches WHERE tenant_id=? AND payout_reference=? FOR UPDATE`,[ctx.tenant.id,reference]);
    if(existing)fail('PAYOUT_REFERENCE_EXISTS');
    const total=rows.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n);
    if(total>18446744073709551615n)fail('PAYOUT_BATCH_TOTAL_INVALID');
    const batchId=crypto.randomUUID(),currency=[...currencies][0];
    await db.query(`INSERT INTO sx_sales_commission_payout_batches(id,tenant_id,payout_reference,currency,total_amount_minor,commission_count,created_by_identity_id)
      VALUES(?,?,?,?,?,?,?)`,[batchId,ctx.tenant.id,reference,currency,total.toString(),rows.length,ctx.identity.id]);
    const [updated]=await db.query(`UPDATE sx_sales_commissions SET status='paid',paid_by_identity_id=?,paid_at=UTC_TIMESTAMP(3),payout_reference=?,payout_batch_id=?
      WHERE tenant_id=? AND status='approved' AND id IN (${ids.map(()=>'?').join(',')})`,[ctx.identity.id,reference,batchId,ctx.tenant.id,...ids]);
    if(Number(updated.affectedRows)!==ids.length)fail('COMMISSION_PAYOUT_BATCH_CONFLICT');
    for(const row of rows)await audit(db,ctx,'sales.commission.paid','sales_commission',row.id,null,{reference,payoutBatchId:batchId});
    await audit(db,ctx,'sales.commission.payout_batch.created','sales_commission_payout_batch',batchId,null,{reference,currency,totalMinor:total.toString(),commissionCount:rows.length});
    await db.commit();
    return {id:batchId,reference,currency,totalMinor:total.toString(),commissionCount:rows.length,status:'paid'};
  }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('PAYOUT_REFERENCE_EXISTS');throw error;}
}
module.exports={submit,listDeals,decide,listCommissions,commissionAction,createCommissionPayoutBatch};
