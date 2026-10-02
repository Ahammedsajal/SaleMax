'use strict';

// Adds one synthetic public-form fixture to the isolated port-3020 panel lab.
// This script never reads .env and refuses non-lab database names.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');

const root=path.resolve(__dirname,'..');
const runtime=path.join(root,'database/local-runtime/training-finance-panel-lab');
const access=JSON.parse(fs.readFileSync(path.join(runtime,'access.json'),'utf8'));
if(access.syntheticData!==true||!/^salemax_panel_lab_[a-f0-9]{12}$/.test(access.database)||!/^panel-[a-f0-9-]{36}$/.test(access.tenantSlug))throw new Error('SYNTHETIC_PANEL_FIXTURE_REQUIRED');

async function main(){
  const db=await mysql.createConnection({host:'127.0.0.1',port:3309,user:'root',password:'',database:access.database});
  try{
    const [[owner]]=await db.query(`SELECT t.id AS tenantId,t.slug AS tenantSlug,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus FROM sx_tenants t JOIN sx_memberships m ON m.tenant_id=t.id AND m.role='owner' WHERE t.slug=? LIMIT 1`,[access.tenantSlug]);
    if(!owner||owner.tenantStatus!=='active'||owner.membershipStatus!=='active'||owner.categoryKey!=='training_center'||Number(owner.categoryVersion)!==1)throw new Error('SYNTHETIC_TRAINING_OWNER_REQUIRED');
    const [[current]]=await db.query(`SELECT a.role_limits AS roleLimits,v.capabilities FROM sx_plan_assignments a JOIN sx_plan_versions v ON v.id=a.plan_version_id WHERE a.tenant_id=? AND a.current_tenant IS NOT NULL AND v.status='published' LIMIT 1`,[owner.tenantId]);
    if(!current)throw new Error('SYNTHETIC_PUBLISHED_PLAN_REQUIRED');
    const capabilities=typeof current.capabilities==='string'?JSON.parse(current.capabilities):current.capabilities;
    if(!Array.isArray(capabilities))throw new Error('SYNTHETIC_PLAN_DATA_INVALID');
    if(!capabilities.includes('portal.forms')){
      const roleLimits=typeof current.roleLimits==='string'?JSON.parse(current.roleLimits):current.roleLimits;
      const planId=crypto.randomUUID(),versionId=crypto.randomUUID(),assignmentId=crypto.randomUUID();
      await db.beginTransaction();
      try{
        await db.query("INSERT INTO sx_plans(id,name,next_version) VALUES (?,'Synthetic public form browser fixture',2)",[planId]);
        await db.query(`INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,status,revision,capabilities,role_limits,published_at) VALUES (?,?,1,'training_center',1,'published',1,?,?,UTC_TIMESTAMP(3))`,[versionId,planId,JSON.stringify([...capabilities,'portal.forms']),JSON.stringify(roleLimits)]);
        await db.query("UPDATE sx_plan_assignments SET status='superseded' WHERE tenant_id=? AND current_tenant IS NOT NULL",[owner.tenantId]);
        await db.query(`INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at) VALUES (?,?,?,?,'active',UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY))`,[assignmentId,owner.tenantId,versionId,JSON.stringify(roleLimits)]);
        await db.commit();
      }catch(error){await db.rollback();throw error;}
    }
    const context={audience:'tenant',identity:{id:owner.identityId},tenant:{id:owner.tenantId,status:'active',categoryKey:owner.categoryKey,categoryVersion:Number(owner.categoryVersion)},membership:{id:owner.membershipId,tenantId:owner.tenantId,identityId:owner.identityId,role:'owner',status:'active'},category:require('../modules/platform/categories').getCategory(owner.categoryKey,Number(owner.categoryVersion)),subscription:{status:'active',capabilities:capabilities.includes('portal.forms')?capabilities:[...capabilities,'portal.forms']}};
    const slug='browser-check-'+crypto.randomBytes(3).toString('hex');
    const forms=require('../modules/platform/training-forms');
    const form=await forms.create(db,context,{slug,nameEn:'Browser acceptance enquiry',nameAr:'استفسار اختبار المتصفح',schema:{titleEn:'Tell us about your course goals',titleAr:'أخبرنا عن أهدافك التدريبية',descriptionEn:'Synthetic local test only.',descriptionAr:'اختبار محلي افتراضي فقط.',consentTextEn:'I agree that the synthetic training center may contact me about this test enquiry.',consentTextAr:'أوافق على تواصل مركز التدريب الافتراضي معي بخصوص هذا الاختبار.',fields:[{key:'contact_name',required:true,labelEn:'Full name',labelAr:'الاسم الكامل'},{key:'phone',required:true,labelEn:'WhatsApp number',labelAr:'رقم واتساب'},{key:'learner_name',required:false,labelEn:'Learner name',labelAr:'اسم المتعلم'},{key:'consent',required:true,labelEn:'Contact permission',labelAr:'الموافقة على التواصل'}]}});
    await forms.publish(db,context,form.id,form.draftRevision);
    console.log(JSON.stringify({syntheticData:true,externalWrites:false,url:`http://127.0.0.1:3020/p/${owner.tenantSlug}/forms/${slug}`}));
  }finally{await db.end();}
}
main().catch(error=>{console.error(error.code||error.message||'SYNTHETIC_FORM_SEED_FAILED');process.exitCode=1;});
