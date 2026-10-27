'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const authority=require('../modules/platform/real-estate-authority');
const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20270111_real_estate_authority.sql'),'utf8');
const contactDocumentsMigration=fs.readFileSync(path.join(__dirname,'../database/migrations/20270113_real_estate_contact_documents.sql'),'utf8');
const tenant='11111111-1111-4111-8111-111111111111',partner='99999999-9999-4999-8999-999999999999',unit='44444444-4444-4444-8444-444444444444';
const context={audience:'tenant',tenant:{id:tenant,status:'active',categoryKey:'real_estate',categoryVersion:1},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:tenant,role:'owner',status:'active'},identity:{id:'22222222-2222-4222-8222-222222222222'},category:require('../modules/platform/categories').realEstate,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']}};
const agreement={contactId:'55555555-5555-4555-8555-555555555555',parentAgreementId:'66666666-6666-4666-8666-666666666666',agreementType:'brokerage',startsOn:'2026-10-27',endsOn:'2027-10-27',unitIds:[unit],permittedChannels:['property_portal'],mayAdvertise:true,mediaApproved:true,descriptionApproved:true};

test('agreement validation requires a bounded unit scope and explicitly valid marketing fields',()=>{
  assert.equal(authority.cleanAgreement(agreement).unitIds.length,1);
  assert.throws(()=>authority.cleanAgreement({...agreement,unitIds:[]}),{code:'INVALID_AGREEMENT_SCOPE'});
  assert.throws(()=>authority.cleanAgreement({...agreement,parentAgreementId:undefined}),{code:'PARENT_AUTHORITY_REQUIRED'});
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


test('agreement directory evaluates owner-to-manager-to-broker authority chains',async()=>{
  const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return [[],[]];}};
  await authority.listAgreements(db,context);
  assert.equal(calls.length,1);
  assert.equal(calls[0].args[0],tenant);
  assert.match(calls[0].sql,/a\.agreement_type='management' AND pa\.agreement_type='owner_mandate'/);
  assert.match(calls[0].sql,/a\.agreement_type IN \('brokerage','referral'\) AND pa\.agreement_type IN \('owner_mandate','management'\)/);
  assert.match(calls[0].sql,/opa\.agreement_type='owner_mandate'/);
  assert.match(calls[0].sql,/opc\.contact_type='owner'/);
  assert.match(calls[0].sql,/pc\.contact_type='property_manager'/);
  assert.match(calls[0].sql,/parentAuthorityActive/);
});

test('agreement history is tenant-scoped and reads audit events for that agreement only',async()=>{
  const id='88888888-8888-4888-8888-888888888888',calls=[];
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT id FROM sx_real_estate_agreements'))return [[{id}],[]];if(sql.startsWith('SELECT e.id,e.action'))return [[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',action:'real-estate.agreement-revoked',changes:'{"from":"active","to":"revoked"}',actorName:'Owner',occurredAt:'2026-10-27 12:00:00'}],[]];throw Error('unexpected query');}};
  const result=await authority.listAgreementHistory(db,context,id);
  assert.deepEqual(calls.map(call=>call.args),[[tenant,id],[tenant,id]]);
  assert.match(calls[1].sql,/resource_type='real-estate-agreement'/);
  assert.deepEqual(result.items[0].changes,{from:'active',to:'revoked'});
});

test('schema keeps contacts and agreements tenant-qualified, scoped to units, and auditable',()=>{
  for(const table of ['sx_real_estate_contacts','sx_real_estate_agreements','sx_real_estate_agreement_units'])assert.match(migration,new RegExp(`CREATE TABLE ${table}`));
  assert.match(migration,/FOREIGN KEY\(tenant_id,contact_id\) REFERENCES sx_real_estate_contacts\(tenant_id,id\)/);
  assert.match(migration,/FOREIGN KEY\(tenant_id,unit_id\) REFERENCES sx_real_estate_units\(tenant_id,id\)/);
  assert.match(migration,/FOREIGN KEY\(tenant_id,responsible_membership_id\) REFERENCES sx_memberships\(tenant_id,id\)/);
  assert.match(fs.readFileSync(path.join(__dirname,'../database/migrations/20270112_real_estate_agreement_parent.sql'),'utf8'),/FOREIGN KEY\(tenant_id,parent_agreement_id\) REFERENCES sx_real_estate_agreements\(tenant_id,id\)/);
  assert.match(migration,/partner_tenant_id CHAR\(36\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
  assert.match(contactDocumentsMigration,/CREATE TABLE sx_real_estate_contact_documents/);
  assert.match(contactDocumentsMigration,/FOREIGN KEY\(tenant_id,contact_id\) REFERENCES sx_real_estate_contacts\(tenant_id,id\)/);
  assert.match(contactDocumentsMigration,/FOREIGN KEY\(tenant_id,created_by_identity_id\) REFERENCES sx_memberships\(tenant_id,identity_id\)/);
});

test('owner and partner cards expose the private company-document workflow',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/authority.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/real-estate-properties-router.js'),'utf8');
  assert.match(ui,/data-contact-documents/);
  assert.match(ui,/Company documents/);
  assert.match(router,/contacts\/:id\/documents/);
  assert.match(router,/contacts\/:id\/documents\/:documentId\/content/);
});

test('contact and agreement type labels select the active language value',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/authority.js'),'utf8');
  assert.match(ui,/t\(\.\.\.\(\(\{owner:\['Owner','مالك'\]/);
  assert.match(ui,/t\(\.\.\.\(\(\{owner_mandate:\['Owner mandate','تفويض المالك'\]/);
});

test('contact directory excludes contacts without a licence expiry date from renewal reminders',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/authority.js'),'utf8');
  assert.match(ui,/const licenseStates=items\.map\(contact=>\(\{contact,days:daysLeft\(contact\)\}\)\)/);
  assert.match(ui,/days!==null&&days>=0&&days<=30/);
  assert.match(ui,/days!==null&&days<0/);
});

test('contact directory surfaces a bilingual licence expiry summary and card warnings',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/authority.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/properties.css'),'utf8');
  assert.match(ui,/license-summary/);
  assert.match(ui,/expired or due for renewal within 30 days/);
  assert.match(ui,/منتهية أو تستحق التجديد خلال ٣٠ يومًا/);
  assert.match(ui,/days<=30/);
  assert.match(css,/\.license-summary\.urgent/);
  assert.match(css,/\[data-sx-theme=dark\] \.license-summary/);
});
