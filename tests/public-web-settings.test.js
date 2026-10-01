'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {publicWebSettings}=require('../modules/platform/public-web-settings');

test('public settings omit the Meta app secret and preserve fields used by login and branding',()=>{
  const settings=publicWebSettings({app_name:'SaleMaX',fb_login_app_id:'public-app-id',fb_login_app_sec:'private-secret',google_client_id:'public-client-id',google_login_active:1});
  assert.deepEqual(settings,{app_name:'SaleMaX',fb_login_app_id:'public-app-id',google_client_id:'public-client-id',google_login_active:1});
  assert.equal(publicWebSettings(null),null);
});
