'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const authority=require('../modules/platform/real-estate-authority');
const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20270111_real_estate_authority.sql'),'utf8');
const tenant='11111111-1111-4111-8111-111111111111',partner='99999999-9999-4999-8999-999999999999',unit='44444444-4444-4444-8444-444444444444';
const context={audience:'tenant',tenant:{id:tenant,status:'active',categoryKey:'real_estate',categoryVersion:1},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:tenant,role:'owner',status:'active'},identity:{id:'22222222-2222-4222-8222-222222222222'},category:require('../modules/platform/categories').realEstate,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']}};
const agreement={contactId:'55555555-5555-4555-8555-555555555555',agreementType:'brokerage',startsOn:'2026-10-27',endsOn:'2027-10-27',unitIds:[unit],permittedChannels:['property_portal'],mayAdvertise:true,mediaApproved:true,descriptionApproved:true};

test('agreement validation requires a bounded unit scope and explicitly valid marketing fields',()=>{
  assert.equal(authority.cleanAgreement(agreement).unitIds.length,1);
  assert.throws(()=>authority.cleanAgreement({...agreement,unitIds:[]}),{code:'INVALID_AGREEMENT_SCOPE'});
  assert.throws(()=>authority.cleanAgreement({...agreement,permittedChannels:['arbitrary'] }),{code:'INVALID_AGREEMENT_CHANNELS'});
  assert.throws(()=>authority.cleanAgreement({...agreement,endsOn:'2026-10-01'}),{code:'INVALID_AGREEMENT'});
  assert.throws(()=>authority.cleanAgreement({...agreement,mayAdvertise:'yes'}),{code:'INVALID_AGREEMENT'});
});

test('contact validation rejects arbitrary partner tenant identifiers and malformed license dates',()=>{
  assert.throws(()=>authority.cleanContact({contactType:'partner',displayName:'Partner',partnerTenantId:'somebody'}),{code:'INVALID_PARTNER'});
  assert.throws(()=>authority.cleanContact({contactType:'partner',displayName:'Partner',responsibleMembershipId:'someone'}),{code:'INVALID_CONTACT'});
  assert.throws(()=>authority.cleanContact({contactType:'owner',displayName:'Owner',licenseExpiresOn:'2026-02-31'}),{code:'INVALID_CONTACT'});
});

test('listing activation requires an active, in-date explicit advertising mandate with approved media and copy',async()=>{
  const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return [[],[]];}};
  await assert.rejects(authority.assertMayActivateListing(db,context,unit),{code:'PROPERTY_AUTHORITY_REQUIRED'});
  assert.equal(calls[0].args[0],tenant);assert.equal(calls[0].args[1],unit);
  assert.match(calls[0].sql,/a\.may_advertise=1/);assert.match(calls[0].sql,/a\.media_approved=1/);assert.match(calls[0].sql,/a\.description_approved=1/);assert.match(calls[0].sql,/a\.ends_on>=DATE\(CONVERT_TZ/);
});

test('partner reads filter on the authenticated recipient tenant and return only approved shared fields',async()=>{
  const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return [[],[]];}};
  await authority.listShared(db,context);
  assert.equal(calls[0].args[0],tenant);assert.match(calls[0].sql,/c\.partner_tenant_id=\?/);assert.match(calls[0].sql,/a\.may_advertise=1/);assert.match(calls[0].sql,/a\.media_approved=1/);assert.match(calls[0].sql,/p\.status='active'/);
  assert.doesNotMatch(calls[0].sql,/u\.private_address|u\.owner_name|u\.managing_company|c\.phone|c\.email/);
});

test('schema keeps contacts and agreements tenant-qualified, scoped to units, and auditable',()=>{
  for(const table of ['sx_real_estate_contacts','sx_real_estate_agreements','sx_real_estate_agreement_units'])assert.match(migration,new RegExp(`CREATE TABLE ${table}`));
  assert.match(migration,/FOREIGN KEY\(tenant_id,contact_id\) REFERENCES sx_real_estate_contacts\(tenant_id,id\)/);
  assert.match(migration,/FOREIGN KEY\(tenant_id,unit_id\) REFERENCES sx_real_estate_units\(tenant_id,id\)/);
  assert.match(migration,/FOREIGN KEY\(tenant_id,responsible_membership_id\) REFERENCES sx_memberships\(tenant_id,id\)/);
  assert.match(migration,/partner_tenant_id CHAR\(36\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
});
