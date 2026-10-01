'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
async function main() {
  const port=Number(process.env.SALEMAX_TEST_PANEL_PORT||3017);if(![3017,3018].includes(port))throw new Error('SYNTHETIC_PANEL_PORT_ONLY');
  const access=JSON.parse(fs.readFileSync(path.join(__dirname,'../database/local-runtime',port===3017?'existing-panel-lab':'existing-panel-lab-3018','access.json'),'utf8'));
  if(access.syntheticData!==true || access.url!==`http://127.0.0.1:${port}/admin/login` || !/^salemax_panel_lab_[a-f0-9]{12}$/.test(access.database))throw new Error('SYNTHETIC_PANEL_ONLY');
  const origin=`http://127.0.0.1:${port}`;
  const request=async(route,body,token)=>{
    const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  const db=await mysql.createConnection({host:'127.0.0.1',port:3309,user:'root',password:'',database:access.database});
  try {
    const [[before]]=await db.query('SELECT COUNT(*) n FROM plan');
    const body={title:'API synthetic '+crypto.randomBytes(4).toString('hex'),short_description:'Disposable existing-router smoke',price:300,plan_duration_in_days:30,contact_limit:100,qr_account:2,allow_tag:'0',allow_note:true};
    assert.equal((await request('/api/admin/add_plan',body)).data.logout,true);
    assert.equal((await request('/api/admin/add_plan',body,'invalid')).data.logout,true);
    const [[after]]=await db.query('SELECT COUNT(*) n FROM plan');assert.equal(after.n,before.n);
    const login=await request('/api/admin/login',{email:access.email,password:access.password});assert.equal(login.data.success,true);
    const token=login.data.token;
    const publicWeb=await request('/api/web/get_web_public');assert.equal(publicWeb.data.success,true);assert.ok(!Object.hasOwn(publicWeb.data.data,'fb_login_app_sec'));
    const adminWeb=await request('/api/admin/get_web_public');assert.equal(adminWeb.data.success,true);assert.ok(!Object.hasOwn(adminWeb.data.data,'fb_login_app_sec'));
    assert.equal((await request('/api/admin/get_social_login')).data.logout,true);
    const socialSettings=await request('/api/admin/get_social_login',undefined,token);assert.equal(socialSettings.data.success,true);assert.ok(Object.hasOwn(socialSettings.data.data,'fb_login_app_sec'));
    const candidateId=Number(access.provisioningUserId);assert.ok(Number.isSafeInteger(candidateId)&&candidateId>0);
    assert.equal((await request(`/api/admin/business-contracts/${candidateId}/provision-options`)).data.logout,true);
    assert.equal((await request(`/api/admin/business-contracts/${candidateId}/provision-options`,undefined,'invalid')).data.logout,true);
    const platformGate=await request(`/api/admin/business-contracts/${candidateId}/provision-options`,undefined,token);assert.equal(platformGate.status,401);assert.equal(platformGate.data.code,'AUTH_REQUIRED');
    assert.equal((await request('/api/admin/add_plan',body,token)).data.success,true);
    const [[created]]=await db.query('SELECT * FROM plan WHERE title=?',[body.title]);assert.equal(created.allow_tag,0);assert.equal(created.allow_note,1);
    const invalid=await request('/api/admin/edit_plan',{...body,id:created.id,qr_account:'2.5'},token);assert.equal(invalid.data.code,'INVALID_PLAN');assert.ok(invalid.data.errors.qr_account);
    const [[unchanged]]=await db.query('SELECT qr_account FROM plan WHERE id=?',[created.id]);assert.equal(unchanged.qr_account,2);
    assert.equal((await request('/api/admin/edit_plan',{...body,id:created.id,is_trial:'1'},token)).data.success,true);
    const [[trial]]=await db.query('SELECT id,price,is_trial FROM plan WHERE id=?',[created.id]);assert.equal(trial.id,created.id);assert.equal(Number(trial.price),0);assert.equal(trial.is_trial,1);
    const accounts=await request('/api/admin/get_users',undefined,token);assert.equal(accounts.data.success,true);
    const account=accounts.data.data.find(row=>row.uid==='synthetic-business');assert.ok(account);
    for(const row of accounts.data.data)for(const key of ['password','api_key','fcm_data','fcm_inbox'])assert.ok(!(key in row));
    assert.equal((await request('/api/admin/user_plan_context?userId='+account.id)).data.logout,true);
    const context=(await request('/api/admin/user_plan_context?userId='+account.id,undefined,token)).data.data;
    const [[historyBefore]]=await db.query('SELECT COUNT(*) n FROM sx_legacy_plan_assignments');
    const legacyPreview=await request('/api/admin/preview_user_plan',{uid:account.uid,plan:{id:created.id},expectedState:context.state},token);assert.equal(legacyPreview.data.code,'CANONICAL_ASSIGNMENT_REQUIRED',JSON.stringify({status:legacyPreview.status,body:legacyPreview.data}));
    const legacyConfirm=await request('/api/admin/update_plan',{uid:account.uid,plan:{id:created.id},requestId:crypto.randomUUID()},token);assert.equal(legacyConfirm.data.code,'CANONICAL_ASSIGNMENT_REQUIRED');
    const [[historyAfter]]=await db.query('SELECT COUNT(*) n FROM sx_legacy_plan_assignments');assert.equal(historyAfter.n,historyBefore.n);
    const denied=await request('/api/admin/update-admin',{email:'disallowed@example.invalid'},token);assert.equal(denied.status,403);
    const html=await (await fetch(origin+'/admin?page=manage-plans')).text();assert.ok(html.includes('/static/js/main.73648acf.js'));assert.ok(html.includes('/admin-plan-editor.js'));
    console.log(JSON.stringify({originalCompiledShell:true,actualLegacyRouters:true,unauthenticatedWritesDenied:true,invalidTokenWritesDenied:true,publicWebSettingsExcludeMetaSecret:true,adminSocialSettingsRequireAdministrator:true,authorizedAdminCanReadSocialSettings:true,provisionOptionsRequireLegacyAndPlatformSessions:true,authenticatedCreateEdit:true,fieldErrorsPreserveRow:true,trialZeroPrice:true,userListSecretsExcluded:true,actualAssignmentContextRead:true,mappedBusinessLegacyWritersDenied:true,legacyAssignmentHistoryUnchanged:true,syntheticLabScopeEnforced:true,customerDataTouched:false,providerActions:false}));
  } finally {await db.end();}
}
main().catch(error=>{console.error(process.env.SALEMAX_TEST_VERBOSE==='true'?error.stack||error.message:error.code||'EXISTING_PANEL_SMOKE_FAILED');process.exitCode=1;});
