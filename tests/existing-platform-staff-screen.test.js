'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
test('platform staff and invite setup are integrated into the original administration shell',()=>{
  const shell=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  const screen=fs.readFileSync(path.join(root,'client/public/admin-platform-staff.js'),'utf8');
  const contract=JSON.parse(fs.readFileSync(path.join(root,'docs/PLATFORM_STAFF_OPENAPI.json'),'utf8'));
  assert.match(shell,/\/admin-platform-staff\.js\?v=/);
  assert.match(screen,/location\.pathname\.toUpperCase\(\)!=='\/ADMIN'/);
  assert.match(screen,/manage-users/);
  assert.match(screen,/staff-invite=/);
  assert.match(screen,/staff-invitations\/accept/);
  assert.match(screen,/One-time setup link copied/);
  assert.match(screen,/لا ترسل هذه الشاشة بريدًا إلكترونيًا/);
  assert.match(screen,/data-lang/);
  assert.match(screen,/setAttribute\('aria-modal','true'\)/);
  assert.match(screen,/navigator\.clipboard\.writeText/);
  assert.match(screen,/REAUTH_REQUIRED:t\('Your recent sign-in expired/);
  assert.match(screen,/Complete verification within five minutes of signing in/);
  assert.match(screen,/ضبط وقت الهاتف تلقائيًا/);
  assert.deepEqual(Object.keys(contract.paths).sort(),[
    '/api/admin/platform-access/staff','/api/admin/platform-access/staff/invitations',
    '/api/admin/platform-access/staff/invitations/{id}/cancel','/api/admin/platform-access/staff/invitations/{id}/resend',
    '/api/admin/platform-access/staff/{identityId}','/api/admin/staff-invitations/accept'
  ].sort());
  assert.equal(contract.components.schemas.InvitationCreatedResponse.properties.data.properties.delivery.const,'copy-link');
});
