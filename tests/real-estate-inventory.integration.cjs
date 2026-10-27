'use strict';
// This harness creates and drops a synthetic database on an explicitly supplied
// local Unix socket. It must never connect to a production database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { splitSql } = require('../database/migration-runner');
const migrationRunner = require('../database/migration-runner');
const path = require('node:path');
const inventory = require('../modules/platform/real-estate-inventory');
const media = require('../modules/platform/real-estate-unit-media');
const properties = require('../modules/platform/real-estate-properties');
const authority = require('../modules/platform/real-estate-authority');
const category = require('../modules/platform/categories');
const socketPath = process.env.REAL_ESTATE_SYNTHETIC_SOCKET;
if (process.env.REAL_ESTATE_SYNTHETIC_ONLY !== 'true' || !socketPath || !socketPath.startsWith('/tmp/7network-real-estate-mysql-')) throw Error('Disposable local socket and synthetic-only flag required');
const schema = `re_test_${crypto.randomBytes(6).toString('hex')}`;
const tenant = '11111111-1111-4111-8111-111111111111', identity = '22222222-2222-4222-8222-222222222222', member = '33333333-3333-4333-8333-333333333333', legacy = '44444444-4444-4444-8444-444444444444';
const context = { audience:'tenant', tenant:{id:tenant,status:'active',categoryKey:'real_estate',categoryVersion:1}, membership:{id:member,tenantId:tenant,role:'owner',status:'active'}, identity:{id:identity}, category:category.realEstate, subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']} };
async function migrate(db, file) {
  const [[version]]=await db.query('SELECT VERSION() AS version');
  if(String(version.version).toLowerCase().includes('mariadb')){
    const migrations=migrationRunner.discover(path.join(__dirname,'../database/migrations'));
    await migrationRunner.applyMigrations(db,migrations,{only:path.basename(file)});
    const repeated=await migrationRunner.applyMigrations(db,migrations,{only:path.basename(file)});
    assert.deepEqual(repeated.skipped,[path.basename(file)]);
  }else{
    const sql = fs.readFileSync(file, 'utf8').replace(/\bPERSISTENT\b/g, 'STORED');
    for (const statement of splitSql(sql)) await db.query(statement);
  }
}
async function main() {
  const admin = await mysql.createConnection({user:'root',socketPath});
  let pool;
  try {
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    pool = mysql.createPool({user:'root',socketPath,database:schema,connectionLimit:4});
    await migrate(pool, 'database/migrations/20261001_platform_identity.sql');
    await migrate(pool, 'database/migrations/20261222_real_estate_properties.sql');
    await pool.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,'synthetic','Synthetic','real_estate',1,'active')",[tenant]);
    await pool.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,'synthetic@example.invalid','Synthetic','active')",[identity]);
    await pool.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[member,tenant,identity]);
    await pool.query("INSERT INTO sx_real_estate_properties(id,tenant_id,reference_code,title_en,title_ar,property_type,transaction_type,status,price_minor,city,description_en,description_ar,created_by_identity_id,updated_by_identity_id) VALUES (?,?,'RE-OLD','Legacy','قديم','apartment','rent','active',600000,'Doha','','',?,?)",[legacy,tenant,identity,identity]);
    await migrate(pool, 'database/migrations/20270110_real_estate_units_and_listings.sql');
    await migrate(pool, 'database/migrations/20270111_real_estate_authority.sql');
    await migrate(pool, 'database/migrations/20270112_real_estate_agreement_parent.sql');
    await migrate(pool, 'database/migrations/20270113_real_estate_contact_documents.sql');
    await migrate(pool, 'database/migrations/20270114_real_estate_content_approval.sql');
    const [[mapped]] = await pool.query('SELECT p.id,p.unit_id AS unitId,u.availability FROM sx_real_estate_properties p JOIN sx_real_estate_units u ON u.tenant_id=p.tenant_id AND u.id=p.unit_id WHERE p.id=?',[legacy]);
    assert.deepEqual(mapped,{id:legacy,unitId:legacy,availability:'available'});
    const db = await pool.getConnection();
    const unit = await inventory.createUnit(db,context,{name:'Test unit',propertyType:'villa',area:'Doha',bedrooms:2});
    await inventory.updateUnit(db,context,unit.id,{expectedRevision:1,furnishing:'furnished',areaSqm:125.5,ownerName:'Synthetic owner',amenities:['Pool'],availableFrom:'2026-11-30'});
    const details=await inventory.getUnit(db,context,unit.id);
    assert.equal(details.furnishing,'furnished');assert.equal(Number(details.areaSqm),125.5);assert.deepEqual(details.amenities,['Pool']);assert.equal(details.ownerName,'Synthetic owner');
    if (!process.env.SALEMAX_PROPERTY_MEDIA_DIR?.startsWith('/tmp/7network-real-estate-media-')) throw Error('Disposable media directory required');
    await media.ensureDirectories();
    const tempFile=media.tempDirectory()+'/synthetic.png';
    const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);fs.writeFileSync(tempFile,bytes);
    const uploaded=await media.attach(db,context,unit.id,{name:'test.png',mimetype:'image/png',size:bytes.length,tempFilePath:tempFile,mv:target=>fs.promises.rename(tempFile,target)});
    let files=await media.list(db,context,unit.id);assert.equal(files.items.length,1);assert.equal(files.items[0].isCover,true);
    await media.update(db,context,unit.id,{order:[uploaded.id],coverId:uploaded.id});
    const file=await media.getFile(db,context,unit.id,uploaded.id);assert.deepEqual(fs.readFileSync(file.path),bytes);
    const other={...context,tenant:{...context.tenant,id:'55555555-5555-4555-8555-555555555555'},membership:{...context.membership,tenantId:'55555555-5555-4555-8555-555555555555'}};
    await assert.rejects(media.getFile(db,other,unit.id,uploaded.id),{code:'UNIT_NOT_FOUND'});
    await media.remove(db,context,unit.id,uploaded.id);
    await assert.rejects(media.getFile(db,context,unit.id,uploaded.id),{code:'MEDIA_NOT_FOUND'});
    assert.deepEqual(fs.readFileSync(file.path),bytes);
    let partnerHttpContext=null;const express=require('express');const app=express();app.use('/api/workspace/properties',require('../modules/platform/real-estate-properties-router').createRouter({pool,authenticate(req,res,next){if(req.headers['x-test-actor']==='owner'){req.businessContext=context;next();}else if(req.headers['x-test-actor']==='partner'&&partnerHttpContext){req.businessContext=partnerHttpContext;next();}else res.status(401).json({success:false,code:'AUTH_REQUIRED'});}}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try{
      const url=`http://127.0.0.1:${server.address().port}/api/workspace/properties/units/${unit.id}/media`;
      assert.equal((await fetch(url)).status,401);
      const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'http.png');
      const upload=await fetch(url,{method:'POST',headers:{'x-test-actor':'owner'},body:form});assert.equal(upload.status,201);const httpMedia=(await upload.json()).data;
      const response=await fetch(`${url}/${httpMedia.id}/content`,{headers:{'x-test-actor':'owner'}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
      assert.equal((await fetch(`${url}/${httpMedia.id}/content`)).status,401);
    }finally{await new Promise(resolve=>server.close(resolve));}
    const listing = await inventory.createListing(db,context,{unitId:unit.id,priceMinor:600000,minimumTermMonths:12});
    const second = await inventory.createListing(db,context,{unitId:unit.id,priceMinor:620000,minimumTermMonths:12});
    const agentIdentity='66666666-6666-4666-8666-666666666666',agentMember='77777777-7777-4777-8777-777777777777';
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,'agent@example.invalid','Agent','active')",[agentIdentity]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'agent','active')",[agentMember,tenant,agentIdentity]);
    const assignedContact=await authority.createContact(db,context,{contactType:'owner',displayName:'Owner with assigned agent',responsibleMembershipId:agentMember});
    assert.equal((await authority.listContacts(db,context)).items.find(item=>item.id===assignedContact.id).responsibleName,'Agent');
    const agent={...context,identity:{id:agentIdentity},membership:{...context.membership,id:agentMember,role:'agent'}};
    assert.equal((await inventory.listUnits(db,agent)).items.some(item=>item.id===unit.id),false);
    await properties.update(db,context,second.id,{assignedMembershipId:agentMember,expectedRevision:1});
    assert.equal((await inventory.listUnits(db,agent)).items.some(item=>item.id===unit.id),true);
    await properties.update(db,context,second.id,{assignedMembershipId:null,expectedRevision:2});
    assert.equal((await inventory.listUnits(db,agent)).items.some(item=>item.id===unit.id),false);
    await properties.update(db,context,listing.id,{depositMinor:600000,tenantFeeMinor:300000,feePayer:'tenant',includedServices:['water','electricity'],freeMonths:1,promotionTerms:'On a 12 month contract',expectedRevision:1});
    const [[terms]]=await db.query('SELECT deposit_minor AS depositMinor,tenant_fee_minor AS tenantFeeMinor,included_services AS services FROM sx_real_estate_properties WHERE tenant_id=? AND id=?',[tenant,listing.id]);
    assert.equal(Number(terms.depositMinor),600000);assert.equal(Number(terms.tenantFeeMinor),300000);assert.deepEqual(typeof terms.services==='string'?JSON.parse(terms.services):terms.services,['water','electricity']);
    await assert.rejects(properties.update(db,context,listing.id,{status:'active',expectedRevision:2}),{code:'PROPERTY_AUTHORITY_REQUIRED'});
    const [todayRows]=await db.query("SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+03:00')),'%Y-%m-%d') AS today");
    const contact=await authority.createContact(db,context,{contactType:'owner',displayName:'Synthetic owner'});
    const expiredMandate=await authority.createAgreement(db,context,{contactId:contact.id,agreementType:'owner_mandate',startsOn:'2020-01-01',endsOn:'2020-12-31',unitIds:[unit.id],mayAdvertise:true,mediaApproved:true,descriptionApproved:true,permittedChannels:['website']});
    await assert.rejects(authority.setAgreementStatus(db,context,expiredMandate.id,{status:'active',expectedRevision:1}),{code:'AGREEMENT_NOT_IN_EFFECT'});await authority.setAgreementStatus(db,context,expiredMandate.id,{status:'expired',expectedRevision:1});
    const photo=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]),photoPath=media.tempDirectory()+'/shared-photo.png';fs.writeFileSync(photoPath,photo);const sharedPhoto=await media.attach(db,context,unit.id,{name:'approved-photo.png',mimetype:'image/png',size:photo.length,tempFilePath:photoPath,mv:target=>fs.promises.rename(photoPath,target)});
    const mandate=await authority.createAgreement(db,context,{contactId:contact.id,agreementType:'owner_mandate',startsOn:todayRows[0].today,endsOn:'2030-12-31',unitIds:[unit.id],mayAdvertise:true,mayConductViewings:true,mayReferAgents:true,mediaApproved:true,descriptionApproved:true,permittedChannels:['website','property_portal'],commissionBasis:'first_month_rent'});
    await authority.setAgreementStatus(db,context,mandate.id,{status:'active',expectedRevision:1});
    const editedContact=await authority.updateContact(db,context,contact.id,{contactType:'owner',displayName:'Synthetic owner',companyName:'',email:'',phone:'+974 5555 0000',licenseNumber:'',licenseExpiresOn:null,partnerTenantId:null,notes:'',status:'active',expectedRevision:1});assert.equal(editedContact.revision,2);
    await assert.rejects(authority.updateContact(db,context,contact.id,{contactType:'owner',displayName:'Synthetic owner',companyName:'',email:'',phone:'+974 5555 0000',licenseNumber:'',licenseExpiresOn:null,partnerTenantId:null,notes:'',status:'inactive',expectedRevision:2}),{code:'CONTACT_HAS_ACTIVE_AGREEMENTS'});
    const pdfPath=media.tempDirectory()+'/mandate.pdf',pdfBytes=Buffer.from('%PDF-1.4\nsynthetic mandate\n%%EOF');fs.writeFileSync(pdfPath,pdfBytes);
    const document=await authority.attachDocument(db,context,mandate.id,{tempFilePath:pdfPath,size:pdfBytes.length,mimetype:'application/pdf',name:'signed-mandate.pdf',mv:target=>fs.promises.rename(pdfPath,target)});
    assert.equal((await authority.listDocuments(db,context,mandate.id)).items.length,1);assert.deepEqual(fs.readFileSync((await authority.getDocument(db,context,mandate.id,document.id)).path),pdfBytes);
    await properties.update(db,context,listing.id,{status:'active',expectedRevision:2});
    await properties.update(db,context,second.id,{status:'active',expectedRevision:3});
    const partnerTenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',partnerIdentity='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',partnerMember='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,'synthetic-partner','Synthetic partner','real_estate',1,'active')",[partnerTenant]);
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,'partner@example.invalid','Partner','active')",[partnerIdentity]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[partnerMember,partnerTenant,partnerIdentity]);
    const managerContact=await authority.createContact(db,context,{contactType:'property_manager',displayName:'Synthetic property manager'});
    const managementAgreement=await authority.createAgreement(db,context,{contactId:managerContact.id,parentAgreementId:mandate.id,agreementType:'management',startsOn:todayRows[0].today,endsOn:'2030-12-31',unitIds:[unit.id],mayAdvertise:true,mayConductViewings:true,mayReferAgents:true,mediaApproved:true,descriptionApproved:true,permittedChannels:['website','property_portal']});
    await authority.setAgreementStatus(db,context,managementAgreement.id,{status:'active',expectedRevision:1});
    const partnerContact=await authority.createContact(db,context,{contactType:'brokerage',displayName:'Synthetic brokerage',partnerTenantId:partnerTenant});
    const partnerAgreement=await authority.createAgreement(db,context,{contactId:partnerContact.id,parentAgreementId:managementAgreement.id,agreementType:'brokerage',startsOn:todayRows[0].today,endsOn:'2030-12-31',unitIds:[unit.id],exclusive:true,mayAdvertise:true,mediaApproved:true,descriptionApproved:true,permittedChannels:['property_portal']});
    await authority.setAgreementStatus(db,context,partnerAgreement.id,{status:'active',expectedRevision:1});
    const agreementDirectory=await authority.listAgreements(db,context);
    assert.ok(agreementDirectory.items.find(item=>item.id===managementAgreement.id)?.parentAuthorityActive);
    assert.ok(agreementDirectory.items.find(item=>item.id===partnerAgreement.id)?.parentAuthorityActive);
    const secondBrokerage=await authority.createContact(db,context,{contactType:'brokerage',displayName:'Synthetic second brokerage',partnerTenantId:partnerTenant});
    const competingAgreement=await authority.createAgreement(db,context,{contactId:secondBrokerage.id,parentAgreementId:managementAgreement.id,agreementType:'brokerage',startsOn:todayRows[0].today,endsOn:'2030-12-31',unitIds:[unit.id],mayAdvertise:true,mediaApproved:true,descriptionApproved:true,permittedChannels:['property_portal']});
    await assert.rejects(authority.setAgreementStatus(db,context,competingAgreement.id,{status:'active',expectedRevision:1}),{code:'AGREEMENT_EXCLUSIVITY_CONFLICT'});
    const partnerContext={...context,tenant:{...context.tenant,id:partnerTenant},membership:{...context.membership,id:partnerMember,tenantId:partnerTenant},identity:{id:partnerIdentity}};
    const shared=await authority.listShared(db,partnerContext);assert.equal(shared.items.length,2);assert.ok(shared.items.every(item=>!Object.hasOwn(item,'ownerName')&&!Object.hasOwn(item,'privateAddress')));assert.ok(shared.items.every(item=>Array.isArray(item.media)));
    const withPhoto=await authority.listShared(db,partnerContext),approvedPhoto=withPhoto.items[0].media.find(file=>file.name==='approved-photo.png');assert.ok(approvedPhoto);const sharedApp=express();sharedApp.use('/api/workspace/properties',require('../modules/platform/real-estate-properties-router').createRouter({pool,authenticate(req,_res,next){req.businessContext=partnerContext;next();}}));const sharedServer=sharedApp.listen(0,'127.0.0.1');await new Promise(resolve=>sharedServer.once('listening',resolve));try{const photoResponse=await fetch(`http://127.0.0.1:${sharedServer.address().port}${approvedPhoto.url}`);assert.equal(photoResponse.status,200);assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()),photo);}finally{await new Promise(resolve=>sharedServer.close(resolve));}
    await media.remove(db,context,unit.id,sharedPhoto.id);assert.equal((await authority.listShared(db,partnerContext)).items.length,0);
    await assert.rejects(authority.refreshContentApproval(db,context,managementAgreement.id,{expectedRevision:2}),{code:'CONTENT_APPROVAL_REQUIRED'});
    await authority.refreshContentApproval(db,context,mandate.id,{expectedRevision:2});await authority.refreshContentApproval(db,context,managementAgreement.id,{expectedRevision:2});await authority.refreshContentApproval(db,context,partnerAgreement.id,{expectedRevision:2});assert.equal((await authority.listShared(db,partnerContext)).items.length,2);
    await db.query("UPDATE sx_real_estate_properties SET description_en='Changed after approval' WHERE tenant_id=? AND id=?",[tenant,listing.id]);assert.equal((await authority.listShared(db,partnerContext)).items.length,0);
    await properties.update(db,context,listing.id,{status:'paused',expectedRevision:3});await assert.rejects(properties.update(db,context,listing.id,{status:'active',expectedRevision:4}),{code:'CONTENT_APPROVAL_REQUIRED'});
    await authority.refreshContentApproval(db,context,mandate.id,{expectedRevision:3});await authority.refreshContentApproval(db,context,managementAgreement.id,{expectedRevision:3});await authority.refreshContentApproval(db,context,partnerAgreement.id,{expectedRevision:3});await properties.update(db,context,listing.id,{status:'active',expectedRevision:4});assert.equal((await authority.listShared(db,partnerContext)).items.length,2);
    const listed=await properties.list(db,context,{unitId:unit.id,status:'active',search:'Doha'});
    assert.equal(listed.total,2);assert.ok(listed.items.every(item=>item.unitId===unit.id&&Number(item.minimumTermMonths)===12));
    await authority.setAgreementStatus(db,context,mandate.id,{status:'revoked',expectedRevision:4});
    const history=await authority.listAgreementHistory(db,context,mandate.id);
    assert.ok(history.items.some(item=>item.action==='real-estate.agreement-revoked'));
    const [[stillAuthorized]]=await db.query("SELECT COUNT(*) AS total FROM sx_real_estate_properties WHERE tenant_id=? AND unit_id=? AND status='active'",[tenant,unit.id]);assert.equal(Number(stillAuthorized.total),0);
    assert.equal((await authority.listShared(db,partnerContext)).items.length,0);
    await authority.setAgreementStatus(db,context,partnerAgreement.id,{status:'revoked',expectedRevision:4});
    const [[revokedListings]]=await db.query("SELECT COUNT(*) AS total FROM sx_real_estate_properties WHERE tenant_id=? AND unit_id=? AND status='paused'",[tenant,unit.id]);assert.equal(Number(revokedListings.total),2);
    await inventory.setAvailability(db,context,unit.id,{availability:'rented',expectedRevision:2});
    const [closed] = await db.query('SELECT status FROM sx_real_estate_properties WHERE tenant_id=? AND unit_id=?',[tenant,unit.id]);
    assert.deepEqual(closed.map(row=>row.status).sort(),['paused','paused']);
    db.release();
    const c1 = await pool.getConnection(), c2 = await pool.getConnection();
    try {
      const raceUnit = await inventory.createUnit(c1,context,{name:'Race unit',propertyType:'apartment'});
      const raceListing = await inventory.createListing(c1,context,{unitId:raceUnit.id,priceMinor:500000});
      const raceMandate=await authority.createAgreement(c1,context,{contactId:contact.id,agreementType:'owner_mandate',startsOn:todayRows[0].today,endsOn:'2030-12-31',unitIds:[raceUnit.id],mayAdvertise:true,mediaApproved:true,descriptionApproved:true,permittedChannels:['website']});
      await authority.setAgreementStatus(c1,context,raceMandate.id,{status:'active',expectedRevision:1});
      await Promise.allSettled([properties.update(c1,context,raceListing.id,{status:'active',expectedRevision:1}),inventory.setAvailability(c2,context,raceUnit.id,{availability:'rented',expectedRevision:1})]);
      const [[state]] = await pool.query('SELECT u.availability,p.status FROM sx_real_estate_units u JOIN sx_real_estate_properties p ON p.tenant_id=u.tenant_id AND p.unit_id=u.id WHERE u.id=?',[raceUnit.id]);
      assert.equal(state.availability,'rented');assert.notEqual(state.status,'active');
    } finally { c1.release();c2.release(); }
    process.stdout.write('Synthetic migrations, owner-to-manager-to-broker authority, exact content approvals/reconfirmation, approved photo sharing, partner isolation, media isolation, legacy mapping, two-listing closure and activation race passed.\n');
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
    if(process.env.SALEMAX_PROPERTY_MEDIA_DIR?.startsWith('/tmp/7network-real-estate-media-'))fs.rmSync(process.env.SALEMAX_PROPERTY_MEDIA_DIR,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
