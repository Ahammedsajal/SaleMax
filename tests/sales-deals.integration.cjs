'use strict';
// Synthetic SaleMaX Sales workflow only. Refuses non-loopback/non-test databases.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const {discover,applyMigrations}=require('../database/migration-runner');
const {getCategory}=require('../modules/platform/categories');
const organization=require('../modules/platform/sales-organization');
const policies=require('../modules/platform/sales-commission-policy');
const deals=require('../modules/platform/sales-deals');
const finance=require('../modules/platform/sales-finance');

async function main(){
  if(process.env.LOCAL_ONLY_MODE!=='true'||!['127.0.0.1','localhost','::1'].includes(process.env.DBHOST))throw Error('LOCAL_DATABASE_ONLY');
  if(!/^salemax_migration_test_[a-z0-9_]{1,40}$/.test(process.env.DBNAME||''))throw Error('SYNTHETIC_DATABASE_REQUIRED');
  const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT),user:process.env.DBUSER,password:process.env.DBPASS||'',database:process.env.DBNAME});
  try{
    const [[active]]=await db.query('SELECT DATABASE() AS name');assert.equal(active.name,process.env.DBNAME);
    await db.query('SET FOREIGN_KEY_CHECKS=0');const [existingTables]=await db.query('SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[process.env.DBNAME]);
    for(const row of existingTables)await db.query(`DROP TABLE IF EXISTS \`${String(row.tableName).replace(/`/g,'``')}\``);
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    await db.query('CREATE TABLE instance(id INT PRIMARY KEY,status VARCHAR(20)) ENGINE=InnoDB');await db.query("INSERT INTO instance VALUES(1,'INACTIVE')");
    const migrations=discover(require('node:path').join(__dirname,'../database/migrations'));
    await applyMigrations(db,migrations);
    await db.query(`CREATE TABLE user(id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(999) NOT NULL,name VARCHAR(191) NOT NULL) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE agents(id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,owner_uid VARCHAR(999) NOT NULL,uid VARCHAR(999) NOT NULL,is_active TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB`);

    const tenantId=crypto.randomUUID(),ownerIdentity=crypto.randomUUID(),managerIdentity=crypto.randomUUID(),otherManagerIdentity=crypto.randomUUID(),leaderIdentity=crypto.randomUUID(),otherLeaderIdentity=crypto.randomUUID(),agentIdentity=crypto.randomUUID(),accountantAIdentity=crypto.randomUUID(),accountantBIdentity=crypto.randomUUID();
    const ids={owner:crypto.randomUUID(),manager:crypto.randomUUID(),otherManager:crypto.randomUUID(),leader:crypto.randomUUID(),otherLeader:crypto.randomUUID(),agent:crypto.randomUUID(),accountantA:crypto.randomUUID(),accountantB:crypto.randomUUID()};
    await db.query(`INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status,currency) VALUES(?,?,?,?,?,'active','QAR')`,[tenantId,'synthetic-sales-'+tenantId.slice(0,8),'Synthetic Sales', 'salemax_sales',1]);
    for(const [identityId,name] of [[ownerIdentity,'Owner'],[managerIdentity,'Manager'],[otherManagerIdentity,'Other manager'],[leaderIdentity,'Team leader'],[otherLeaderIdentity,'Other leader'],[agentIdentity,'Agent'],[accountantAIdentity,'Accountant A'],[accountantBIdentity,'Accountant B']])await db.query('INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES(?,?,?,\'active\')',[identityId,`${name.toLowerCase().replaceAll(' ','-')}-${tenantId.slice(0,8)}@example.invalid`,name]);
    for(const [key,identityId,role] of [['owner',ownerIdentity,'owner'],['manager',managerIdentity,'manager'],['otherManager',otherManagerIdentity,'manager'],['leader',leaderIdentity,'team_leader'],['otherLeader',otherLeaderIdentity,'team_leader'],['agent',agentIdentity,'agent'],['accountantA',accountantAIdentity,'accountant'],['accountantB',accountantBIdentity,'accountant']])await db.query('INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES(?,?,?,? ,\'active\')',[ids[key],tenantId,identityId,role]);
    const category=getCategory('salemax_sales',1),subscription={status:'active',capabilities:[...category.capabilities]};
    const context=(key,identityId,role)=>({audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:1},membership:{id:ids[key],tenantId,role,status:'active'},category,subscription});
    const ownerCtx=context('owner',ownerIdentity,'owner'),managerCtx=context('manager',managerIdentity,'manager'),otherManagerCtx=context('otherManager',otherManagerIdentity,'manager'),leaderCtx=context('leader',leaderIdentity,'team_leader'),otherLeaderCtx=context('otherLeader',otherLeaderIdentity,'team_leader'),accountantACtx=context('accountantA',accountantAIdentity,'accountant'),accountantBCtx=context('accountantB',accountantBIdentity,'accountant');

    const ownerUid='synthetic-sales-owner-'+tenantId,ownerUidHash=crypto.createHash('sha256').update(ownerUid).digest('hex');
    const [legacyOwner]=await db.query('INSERT INTO user(uid,name) VALUES(?,?)',[ownerUid,'Synthetic Sales Owner']);
    await db.query(`INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES('user',?,?,?,?,UTC_TIMESTAMP(3))`,[String(legacyOwner.insertId),tenantId,ids.owner,ownerUidHash]);
    const agentUid='synthetic-sales-agent-'+tenantId, [legacyAgent]=await db.query('INSERT INTO agents(owner_uid,uid,is_active) VALUES(?,?,1)',[ownerUid,agentUid]);
    const agentUidHash=crypto.createHash('sha256').update(agentUid).digest('hex');
    await db.query(`INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES('agents',?,?,?,?,UTC_TIMESTAMP(3))`,[String(legacyAgent.insertId),tenantId,ids.agent,agentUidHash]);
    const reason='Synthetic initial organisation fixture';
    for(const [key,managerId,leaderId] of [['manager',null,null],['otherManager',null,null],['leader',ids.manager,null],['otherLeader',ids.otherManager,null],['agent',ids.manager,ids.leader]]){
      try{await db.query(`INSERT INTO sx_sales_org_history(id,tenant_id,membership_id,manager_membership_id,team_leader_membership_id,started_at,ended_at,assigned_by_identity_id,reason) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),NULL,?,?)`,[crypto.randomUUID(),tenantId,ids[key],managerId,leaderId,ownerIdentity,reason]);}
      catch(error){throw Object.assign(error,{message:`Organization fixture insert ${key}: ${error.sqlMessage||error.message}`});}
    }
    const [[activeAgent]]=await db.query('SELECT id FROM agents WHERE owner_uid=?',[ownerUid]);
    const leadId=crypto.randomUUID(),leadUidHash=ownerUidHash;
    await db.query(`INSERT INTO pipeline_stages(uid_hash,uid,stage_key,title,position,stage_type,is_system) VALUES(?,?, 'new','New',1,'open',1),(?,?, 'won','Won',99,'won',1)`,[leadUidHash,ownerUid,leadUidHash,ownerUid]);
    await db.query(`INSERT INTO pipeline_leads(id,uid_hash,uid,identity_key,title,stage_key,owner_agent_id,status,currency) VALUES(?,?,?,?,?,'new',?,'open','QAR')`,[leadId,leadUidHash,ownerUid,crypto.createHash('sha256').update(leadId).digest('hex'),'Synthetic sales lead',activeAgent.id]);

    const product=await policies.createProduct(db,ownerCtx,{code:'SVC-01',name:'Synthetic Service'});
    const draft=await policies.createDraft(db,ownerCtx,{products:[{productId:product.id,agentRateBps:500,teamLeaderRateBps:200,managerRateBps:100}]});
    await policies.approve(db,ownerCtx,draft.id);
    const idempotencyKey=crypto.randomUUID(),saleInput={leadId,productId:product.id,amountMinor:'100000',currency:'QAR',idempotencyKey};
    const submitted=await deals.submit(db,context('agent',agentIdentity,'agent'),saleInput);assert.equal(submitted.status,'pending_approval');
    const retry=await deals.submit(db,context('agent',agentIdentity,'agent'),saleInput);assert.equal(retry.repeated,true);assert.equal(retry.id,submitted.id);
    await assert.rejects(deals.submit(db,context('agent',agentIdentity,'agent'),{...saleInput,amountMinor:'100001'}),{code:'IDEMPOTENCY_CONFLICT'});
    const scoped=await deals.listDeals(db,managerCtx);assert.equal(scoped.items.length,1);assert.equal((await deals.listDeals(db,otherManagerCtx)).items.length,0);assert.equal((await deals.listDeals(db,leaderCtx)).items.length,1);assert.equal((await deals.listDeals(db,otherLeaderCtx)).items.length,0);assert.equal((await deals.listDeals(db,context('agent',agentIdentity,'agent'))).items.length,1);
    await assert.rejects(deals.listDeals(db,accountantACtx),{code:'PERMISSION_DENIED'});
    await assert.rejects(deals.decide(db,otherManagerCtx,submitted.id,{decision:'approve'}),{code:'PERMISSION_DENIED'});
    await assert.rejects(deals.decide(db,context('agent',agentIdentity,'agent'),submitted.id,{decision:'approve'}),{code:'PERMISSION_DENIED'});

    // Move the agent after submission; the original deal attribution must remain.
    await organization.reassign(db,ownerCtx,ids.agent,{managerMembershipId:ids.otherManager,teamLeaderMembershipId:ids.otherLeader,reason:'Synthetic post-submission team change'});
    const approved=await deals.decide(db,managerCtx,submitted.id,{decision:'approve'});assert.equal(approved.status,'approved');assert.equal(approved.commissionMinor,'8000');
    const [[lead]]=await db.query('SELECT status,stage_key,close_reason FROM pipeline_leads WHERE uid_hash=? AND id=?',[leadUidHash,leadId]);assert.equal(lead.status,'won');assert.equal(lead.stage_key,'won');
    const [[deal]]=await db.query('SELECT seller_membership_id AS seller,manager_membership_id AS manager,team_leader_membership_id AS leader,commission_policy_id AS policy FROM sx_sales_deals WHERE id=?',[submitted.id]);assert.equal(deal.manager,ids.manager);assert.equal(deal.leader,ids.leader);assert.ok(deal.policy);
    const commissionList=await deals.listCommissions(db,accountantACtx);assert.equal(commissionList.items.length,3);assert.equal(commissionList.permissions.canApprove,true);
    const ownCommission=commissionList.items.find(item=>item.recipientRole==='agent');assert.ok(ownCommission);
    await deals.commissionAction(db,accountantACtx,ownCommission.id,'approve');
    await assert.rejects(deals.commissionAction(db,accountantACtx,ownCommission.id,'pay',{reference:'SYNTHETIC-1'}),{code:'PAYOUT_SEPARATION_REQUIRED'});
    await deals.commissionAction(db,accountantBCtx,ownCommission.id,'pay',{reference:'SYNTHETIC-1'});
    const [[paid]]=await db.query('SELECT status,paid_by_identity_id AS paidBy,approved_by_identity_id AS approvedBy,payout_reference AS reference FROM sx_sales_commissions WHERE id=?',[ownCommission.id]);assert.equal(paid.status,'paid');assert.notEqual(paid.paidBy,paid.approvedBy);assert.equal(paid.reference,'SYNTHETIC-1');
    const [[activityCount]]=await db.query("SELECT COUNT(*) AS n FROM pipeline_activity WHERE uid_hash=? AND lead_id=? AND activity_type IN ('sale_submitted','sale_approved')",[leadUidHash,leadId]);assert.equal(Number(activityCount.n),2);
    const issuedInvoice=await finance.issueInvoice(db,accountantACtx,submitted.id,{dueAt:'2026-12-31'});assert.match(issuedInvoice.invoiceNumber,/^SMX-\d{4}-\d{6}$/);assert.equal(issuedInvoice.totalMinor,'100000');
    assert.equal((await finance.issueInvoice(db,accountantACtx,submitted.id,{})).repeated,true);
    const receiptInput={idempotencyKey:crypto.randomUUID(),paymentMethod:'bank_transfer',amountMinor:'60000',currency:'QAR',receivedAt:'2026-10-13T09:00:00Z',externalReference:'SYNTHETIC-RECEIPT-1',payerName:'Synthetic Customer',note:'Synthetic reconciliation fixture'};
    const receipt=await finance.recordReceipt(db,accountantACtx,receiptInput);assert.equal((await finance.recordReceipt(db,accountantACtx,receiptInput)).repeated,true);
    const allocation=await finance.allocateReceipt(db,accountantACtx,{receiptId:receipt.id,invoiceId:issuedInvoice.id,idempotencyKey:crypto.randomUUID(),amountMinor:'40000'});
    await assert.rejects(finance.allocateReceipt(db,accountantACtx,{receiptId:receipt.id,invoiceId:issuedInvoice.id,idempotencyKey:crypto.randomUUID(),amountMinor:'30000'}),{code:'RECEIPT_OVERALLOCATED'});
    const invoiceRows=await finance.listInvoices(db,accountantACtx,{status:'outstanding'});assert.equal(invoiceRows.items.length,1);assert.equal(String(invoiceRows.items[0].outstandingMinor),'60000');
    const receiptRows=await finance.listReceipts(db,accountantACtx,{status:'partially_matched'});assert.equal(receiptRows.items.length,1);assert.equal(String(receiptRows.items[0].unmatchedMinor),'20000');
    await finance.reverseAllocation(db,accountantACtx,allocation.id,{reason:'Synthetic reconciliation reversal'});
    assert.equal((await finance.listReceipts(db,accountantACtx,{status:'unmatched'})).items.length,1);
    const summary=await finance.overview(db,accountantACtx);assert.equal(summary.invoicesByCurrency.length,1);assert.equal(String(summary.invoicesByCurrency[0].billedMinor),'100000');
    const [[auditCount]]=await db.query("SELECT COUNT(*) AS n FROM sx_audit_events WHERE tenant_id=? AND action LIKE 'sales.%'",[tenantId]);assert.ok(Number(auditCount.n)>=7);
    const express=require('express'),httpPool=mysql.createPool({host:process.env.DBHOST,port:Number(process.env.DBPORT),user:process.env.DBUSER,password:process.env.DBPASS||'',database:process.env.DBNAME,connectionLimit:3});
    const guard=(req,res,next)=>{const key=req.get('x-synthetic-role')||'owner';const lookup={owner:['owner',ownerIdentity,'owner'],manager:['manager',managerIdentity,'manager'],team_leader:['leader',leaderIdentity,'team_leader'],agent:['agent',agentIdentity,'agent'],accountant:['accountantA',accountantAIdentity,'accountant']};const [membershipKey,identityId,role]=lookup[key]||lookup.owner;req.businessContext=context(membershipKey,identityId,role);next();};
    const app=express();app.use(express.json());app.use('/api/user/sales-commissions',require('../modules/platform/sales-commission-router').createSalesCommissionRouter({pool:httpPool,canonicalGuard:guard}));app.use('/api/user/sales-finance',require('../modules/platform/sales-finance-router').createSalesFinanceRouter({pool:httpPool,canonicalGuard:guard}));app.use('/api/user/sales-organization',require('../modules/platform/sales-organization-router').createSalesOrganizationRouter({pool:httpPool,canonicalGuard:guard}));
    const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    let httpEvidence;
    try{
      const origin=`http://127.0.0.1:${server.address().port}`,headers={'x-synthetic-role':'agent'};
      const dealsResponse=await fetch(`${origin}/api/user/sales-commissions/deals`,{headers});assert.equal(dealsResponse.status,200);assert.equal((await dealsResponse.json()).data.items.length,1);
      const productsResponse=await fetch(`${origin}/api/user/sales-commissions/products`,{headers});assert.equal(productsResponse.status,200);assert.equal((await productsResponse.json()).data.products.length,1);
      const accountantResponse=await fetch(`${origin}/api/user/sales-commissions/commissions`,{headers:{'x-synthetic-role':'accountant'}});assert.equal(accountantResponse.status,200);assert.equal((await accountantResponse.json()).data.items.length,3);
      const deniedResponse=await fetch(`${origin}/api/user/sales-commissions/deals/${submitted.id}/decision`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({decision:'approve'})});assert.equal(deniedResponse.status,403);assert.equal((await deniedResponse.json()).code,'PERMISSION_DENIED');
      const accountantFinance=await fetch(`${origin}/api/user/sales-finance/overview`,{headers:{'x-synthetic-role':'accountant'}});assert.equal(accountantFinance.status,200);
      const agentFinance=await fetch(`${origin}/api/user/sales-finance/invoices`,{headers});assert.equal(agentFinance.status,403);
      const ownerOrg=await fetch(`${origin}/api/user/sales-organization`,{headers:{'x-synthetic-role':'owner'}});assert.equal(ownerOrg.status,200);assert.equal((await ownerOrg.json()).data.members.length,8);
      const managerOrg=await fetch(`${origin}/api/user/sales-organization`,{headers:{'x-synthetic-role':'manager'}});assert.equal(managerOrg.status,200);const managerOrgData=(await managerOrg.json()).data;assert.ok(managerOrgData.members.some(member=>member.membershipId===ids.manager));assert.ok(!managerOrgData.members.some(member=>member.membershipId===ids.otherManager));
      const leaderOrg=await fetch(`${origin}/api/user/sales-organization`,{headers:{'x-synthetic-role':'team_leader'}});assert.equal(leaderOrg.status,200);assert.ok((await leaderOrg.json()).data.members.some(member=>member.membershipId===ids.leader));
      const agentOrg=await fetch(`${origin}/api/user/sales-organization`,{headers});assert.equal(agentOrg.status,403);
      const accountantOrg=await fetch(`${origin}/api/user/sales-organization`,{headers:{'x-synthetic-role':'accountant'}});assert.equal(accountantOrg.status,403);
      const deniedMove=await fetch(`${origin}/api/user/sales-organization/${ids.agent}/reassign`,{method:'POST',headers:{...headers,'x-synthetic-role':'manager','Content-Type':'application/json'},body:JSON.stringify({managerMembershipId:ids.manager,teamLeaderMembershipId:ids.leader,reason:'Out of scope move'})});assert.equal(deniedMove.status,403);
      const ownerMove=await fetch(`${origin}/api/user/sales-organization/${ids.agent}/reassign`,{method:'POST',headers:{...headers,'x-synthetic-role':'owner','Content-Type':'application/json'},body:JSON.stringify({managerMembershipId:ids.manager,teamLeaderMembershipId:ids.leader,reason:'Return synthetic agent to original team'})});const ownerMoveBody=await ownerMove.json();assert.equal(ownerMove.status,200,JSON.stringify(ownerMoveBody));assert.equal(ownerMoveBody.data.managerMembershipId,ids.manager);
      httpEvidence={deals:dealsResponse.status,productList:productsResponse.status,accountantLedger:accountantResponse.status,agentApproval:deniedResponse.status,accountantFinance:accountantFinance.status,agentFinance:agentFinance.status,ownerOrganisation:ownerOrg.status,managerOrganisation:managerOrg.status,teamLeaderOrganisation:leaderOrg.status,agentOrganisationDenied:agentOrg.status,accountantOrganisationDenied:accountantOrg.status,managerCrossTeamMoveDenied:deniedMove.status,ownerMove:ownerMove.status};
    }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await httpPool.end();}
    console.log(JSON.stringify({success:true,migrations:migrations.length,sale:'approved',commissionPolicy:'product-and-role snapshot',commissionRows:commissionList.items.length,payout:'separation enforced',invoice:'issued idempotently',receipt:'recorded idempotently',reconciliation:'partial allocation and reversal',lead:'won',auditEvents:Number(auditCount.n),http:httpEvidence}));
  }finally{await db.end();}
}
main().catch(error=>{console.error('Sales workflow integration failed:',error.code||error.message,error.sqlMessage||'',error.stack||'');process.exitCode=1;});
