'use strict';
const crypto=require('node:crypto');
const {salemaxSales,categoryKeyMatches}=require('./categories');
const {decision}=require('./policy');
const calculator=require('./sales-commission-calculator');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function authorize(ctx){
  if(ctx?.audience!=='tenant'||!categoryKeyMatches(ctx.category?.key,salemaxSales.key)||ctx.category?.version!==salemaxSales.version
    ||!categoryKeyMatches(ctx.tenant?.categoryKey,salemaxSales.key)||Number(ctx.tenant?.categoryVersion)!==salemaxSales.version)fail('CATEGORY_UNAVAILABLE');
  const access=decision(ctx,{capability:'sales.commissions',permission:'commission.policy.manage'});
  if(!access.allowed)fail(access.code);
  if(!ctx.identity?.id||ctx.membership?.role!=='owner')fail('PERMISSION_DENIED');
}
function parseRates(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['agentRateBps','teamLeaderRateBps','managerRateBps'].includes(key)))fail('INVALID_COMMISSION_POLICY');
  return calculator.rates(input);
}
async function audit(db,ctx,action,resourceType,resourceId,changes){
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
    VALUES (?,?,?,'identity',?,?,?,NULL,?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,action,resourceType,resourceId,JSON.stringify(changes),crypto.randomUUID()]);
}
async function products(db,ctx,{includeInactive=true}={}){
  if(ctx?.membership?.role==='owner')authorize(ctx);
  else{if(ctx?.audience!=='tenant'||ctx.category?.key!==salemaxSales.key)fail('CATEGORY_UNAVAILABLE');const access=decision(ctx,{capability:'sales.deals',permission:'deals.read'});if(!access.allowed)fail(access.code);includeInactive=false;}
  const [rows]=await db.query(`SELECT id,code,name,active,created_at AS createdAt,updated_at AS updatedAt FROM sx_sales_products
    WHERE tenant_id=?${includeInactive?'':' AND active=1'} ORDER BY active DESC,name,id`,[ctx.tenant.id]);
  return rows;
}
async function createProduct(db,ctx,input){
  authorize(ctx);
  const code=String(input?.code||'').trim().toUpperCase(),name=String(input?.name||'').trim();
  if(!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code)||name.length<2||name.length>191)fail('INVALID_SALES_PRODUCT');
  const id=crypto.randomUUID();await db.beginTransaction();
  try{await db.query(`INSERT INTO sx_sales_products(id,tenant_id,code,name,created_by_identity_id) VALUES(?,?,?,?,?)`,[id,ctx.tenant.id,code,name,ctx.identity.id]);
    await audit(db,ctx,'sales.product.created','sales_product',id,{code,name,active:true});await db.commit();return {id,code,name,active:true};}
  catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('SALES_PRODUCT_CODE_EXISTS');throw error;}
}
async function setProductActive(db,ctx,id,active){
  authorize(ctx);
  if(!uuid(id)||typeof active!=='boolean')fail('INVALID_SALES_PRODUCT');
  await db.beginTransaction();try{const [[product]]=await db.query('SELECT id,active FROM sx_sales_products WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!product)fail('SALES_PRODUCT_NOT_FOUND');
    if(Number(product.active)!==Number(active))await db.query('UPDATE sx_sales_products SET active=? WHERE tenant_id=? AND id=?',[active?1:0,ctx.tenant.id,id]);
    await audit(db,ctx,active?'sales.product.activated':'sales.product.deactivated','sales_product',id,{active});await db.commit();return {id,active};
  }catch(error){await db.rollback();throw error;}
}
async function list(db,ctx){
  authorize(ctx);
  const [policies]=await db.query(`SELECT id,version,status,created_by_identity_id AS createdByIdentityId,
      approved_by_identity_id AS approvedByIdentityId,approved_at AS approvedAt,created_at AS createdAt
    FROM sx_sales_commission_policies WHERE tenant_id=? ORDER BY version DESC LIMIT 100`,[ctx.tenant.id]);
  const [rateRows]=await db.query(`SELECT r.policy_id AS policyId,r.product_id AS productId,p.code AS productCode,p.name AS productName,
      r.agent_rate_bps AS agentRateBps,r.team_leader_rate_bps AS teamLeaderRateBps,r.manager_rate_bps AS managerRateBps
    FROM sx_sales_commission_policy_rates r JOIN sx_sales_products p ON p.tenant_id=r.tenant_id AND p.id=r.product_id
    WHERE r.tenant_id=? ORDER BY p.name`,[ctx.tenant.id]);
  const byPolicy=new Map();
  for(const rate of rateRows){const rows=byPolicy.get(rate.policyId)||[];rows.push(rate);byPolicy.set(rate.policyId,rows);}
  for(const item of policies)item.products=byPolicy.get(item.id)||[];
  return {policies,active:policies.find(row=>row.status==='approved')||null,products:await products(db,ctx)};
}
async function createDraft(db,ctx,input){
  authorize(ctx);
  if(!Array.isArray(input?.products)||!input.products.length||input.products.length>500)fail('INVALID_COMMISSION_POLICY');
  const mapped=new Map();
  for(const item of input.products){
    if(!item||!uuid(item.productId)||mapped.has(item.productId))fail('INVALID_COMMISSION_POLICY');
    mapped.set(item.productId,parseRates({agentRateBps:item.agentRateBps,teamLeaderRateBps:item.teamLeaderRateBps,managerRateBps:item.managerRateBps}));
  }
  await db.beginTransaction();
  try{
    const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);
    if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [activeProducts]=await db.query('SELECT id FROM sx_sales_products WHERE tenant_id=? AND active=1 ORDER BY id FOR UPDATE',[ctx.tenant.id]);
    if(activeProducts.length!==mapped.size||activeProducts.some(product=>!mapped.has(product.id)))fail('COMMISSION_PRODUCTS_INCOMPLETE');
    const [[latest]]=await db.query('SELECT COALESCE(MAX(version),0) AS version FROM sx_sales_commission_policies WHERE tenant_id=? FOR UPDATE',[ctx.tenant.id]);
    const id=crypto.randomUUID(),version=Number(latest.version)+1;
    await db.query(`INSERT INTO sx_sales_commission_policies(id,tenant_id,version,status,created_by_identity_id)
      VALUES (?,?,?,'draft',?)`,[id,ctx.tenant.id,version,ctx.identity.id]);
    for(const [productId,rates] of mapped)await db.query(`INSERT INTO sx_sales_commission_policy_rates(tenant_id,policy_id,product_id,agent_rate_bps,team_leader_rate_bps,manager_rate_bps)
      VALUES (?,?,?,?,?,?)`,[ctx.tenant.id,id,productId,rates.agent,rates.teamLeader,rates.manager]);
    await audit(db,ctx,'sales.commission_policy.draft_created','sales_commission_policy',id,{version,products:[...mapped].map(([productId,rates])=>({productId,ratesBps:rates}))});
    await db.commit();
    return {id,version,status:'draft',productCount:mapped.size};
  }catch(error){await db.rollback();throw error;}
}
async function approve(db,ctx,policyId){
  authorize(ctx);
  if(!uuid(policyId))fail('INVALID_COMMISSION_POLICY_ID');
  await db.beginTransaction();
  try{
    const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);
    if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [[draft]]=await db.query(`SELECT id,version,status FROM sx_sales_commission_policies WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,policyId]);
    if(!draft)fail('COMMISSION_POLICY_NOT_FOUND');
    if(draft.status!=='draft')fail('COMMISSION_POLICY_NOT_DRAFT');
    const [products]=await db.query(`SELECT p.id FROM sx_sales_products p LEFT JOIN sx_sales_commission_policy_rates r
        ON r.tenant_id=p.tenant_id AND r.product_id=p.id AND r.policy_id=?
      WHERE p.tenant_id=? AND p.active=1 AND r.product_id IS NULL FOR UPDATE`,[policyId,ctx.tenant.id]);
    if(products.length)fail('COMMISSION_PRODUCTS_INCOMPLETE');
    const [[count]]=await db.query('SELECT COUNT(*) AS n FROM sx_sales_commission_policy_rates WHERE tenant_id=? AND policy_id=?',[ctx.tenant.id,policyId]);
    if(!Number(count.n))fail('COMMISSION_PRODUCTS_INCOMPLETE');
    const [rates]=await db.query(`SELECT r.product_id AS productId,r.agent_rate_bps AS agentRateBps,r.team_leader_rate_bps AS teamLeaderRateBps,r.manager_rate_bps AS managerRateBps
      FROM sx_sales_commission_policy_rates r WHERE r.tenant_id=? AND r.policy_id=? ORDER BY r.product_id`,[ctx.tenant.id,policyId]);
    for(const rate of rates)parseRates({agentRateBps:Number(rate.agentRateBps),teamLeaderRateBps:Number(rate.teamLeaderRateBps),managerRateBps:Number(rate.managerRateBps)});
    await db.query(`UPDATE sx_sales_commission_policies SET status='retired',active_tenant_id=NULL WHERE tenant_id=? AND status='approved'`,[ctx.tenant.id]);
    await db.query(`UPDATE sx_sales_commission_policies SET status='approved',active_tenant_id=tenant_id,approved_by_identity_id=?,approved_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='draft'`,[ctx.identity.id,ctx.tenant.id,policyId]);
    await audit(db,ctx,'sales.commission_policy.approved','sales_commission_policy',policyId,{version:Number(draft.version),products:rates.map(rate=>({productId:rate.productId,ratesBps:{agent:Number(rate.agentRateBps),teamLeader:Number(rate.teamLeaderRateBps),manager:Number(rate.managerRateBps)}}))});
    await db.query('UPDATE sx_tenants SET revision=revision+1 WHERE id=?',[ctx.tenant.id]);
    await db.commit();
    return {id:policyId,version:Number(draft.version),status:'approved',productCount:rates.length};
  }catch(error){await db.rollback();throw error;}
}
module.exports={authorize,products,createProduct,setProductActive,list,createDraft,approve};
