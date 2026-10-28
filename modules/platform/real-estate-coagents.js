'use strict';
const crypto=require('node:crypto');
const properties=require('./real-estate-properties');
const valid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
async function list(db,ctx,listingId){
  properties.authorize(ctx,'properties.assign');if(!['owner','manager'].includes(ctx.membership.role))fail('PERMISSION_DENIED',403);if(!valid(listingId))fail('PROPERTY_NOT_FOUND',404);
  const [[listing]]=await db.query('SELECT id FROM sx_real_estate_properties WHERE tenant_id=? AND id=?',[ctx.tenant.id,listingId]);if(!listing)fail('PROPERTY_NOT_FOUND',404);
  const [items]=await db.query('SELECT m.id AS membershipId,i.display_name AS name FROM sx_real_estate_listing_coagents c JOIN sx_memberships m ON m.tenant_id=c.tenant_id AND m.id=c.membership_id JOIN sx_identities i ON i.id=m.identity_id WHERE c.tenant_id=? AND c.listing_id=? ORDER BY i.display_name,m.id',[ctx.tenant.id,listingId]);return {items};
}
async function set(db,ctx,listingId,membershipId,add){
  properties.authorize(ctx,'properties.assign');if(!['owner','manager'].includes(ctx.membership.role))fail('PERMISSION_DENIED',403);if(!valid(listingId)||!valid(membershipId))fail('INVALID_COAGENT');
  await db.beginTransaction();try{
    const [[listing]]=await db.query('SELECT id,assigned_membership_id AS assignee FROM sx_real_estate_properties WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,listingId]);if(!listing)fail('PROPERTY_NOT_FOUND',404);
    const args=[ctx.tenant.id,membershipId];let scope='';if(ctx.membership.role==='manager'){scope=' AND EXISTS (SELECT 1 FROM sx_sales_org_history h WHERE h.tenant_id=m.tenant_id AND h.membership_id=m.id AND h.manager_membership_id=? AND h.ended_at IS NULL)';args.push(ctx.membership.id);}
    const active=add?" AND m.status='active' AND i.status='active'":'';
    const [[member]]=await db.query(`SELECT m.id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.id=? AND m.role='agent'${active}${scope} FOR UPDATE`,args);
    if(!member)fail('PROPERTY_ASSIGNEE_UNAVAILABLE',409);
    if(add&&listing.assignee===membershipId)fail('INVALID_COAGENT');
    let result;if(add)[result]=await db.query('INSERT IGNORE INTO sx_real_estate_listing_coagents (tenant_id,listing_id,membership_id,added_by_identity_id) VALUES (?,?,?,?)',[ctx.tenant.id,listingId,membershipId,ctx.identity.id]);
    else [result]=await db.query('DELETE FROM sx_real_estate_listing_coagents WHERE tenant_id=? AND listing_id=? AND membership_id=?',[ctx.tenant.id,listingId,membershipId]);
    if(result.affectedRows)await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'real-estate-listing',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,add?'real-estate.coagent-added':'real-estate.coagent-removed',listingId,JSON.stringify({membershipId}),crypto.randomUUID()]);
    await db.commit();return {membershipId,added:add};
  }catch(error){await db.rollback();throw error;}
}
module.exports={list,set};
