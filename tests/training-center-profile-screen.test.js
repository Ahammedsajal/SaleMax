'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('training-center profile exposes a responsive bilingual logo upload in the existing workspace', () => {
  const screen = read('client/public/training-courses.js');
  const shell = read('client/public/index.html');
  assert.match(shell, /training-courses\.js\?v=[^"']+/);
  assert.match(screen, /field\('crNumber'/);
  assert.match(screen, /field\('invoicePrefix'/);
  assert.match(screen, /id="sx-profile-logo-file" type="file" accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(screen, /role="button" tabindex="0"/);
  assert.match(screen, /addEventListener\('keydown'/);
  assert.match(screen, /addEventListener\('drop'/);
  assert.match(screen, /JPEG, PNG or WebP/);
  assert.match(screen, /حتى 5 ميجابايت/);
  assert.match(screen, /Uploading logo and saving profile/);
  assert.match(screen, /Remove logo/);
  assert.match(screen, /data-report-destination-label/);
  assert.match(screen, /updateReportDestination/);
  assert.match(screen, /reportDestination.type=email\?'email':'tel'/);
  assert.match(screen, /reportDestination.reportValidity\(\)/);
  assert.match(screen, /autocomplete="one-time-code" pattern="\[0-9\]\{10\}" maxlength="10"/);
});

test('logo upload remains authenticated, signature-checked, bounded and on persistent public media storage', () => {
  const router = read('modules/platform/training-center-profile-router.js');
  const media = read('modules/platform/training-center-logo-media.js');
  const profile = read('modules/platform/training-center-profile.js');
  const compose = read('deploy/compose.yml');
  assert.match(router, /canonicalGuard/);
  assert.match(router, /fileUpload\(\{useTempFiles:true/);
  assert.match(router, /fileSize:profile\.MAX_LOGO_BYTES/);
  assert.match(media, /MAX_LOGO_BYTES = 5 \* 1024 \* 1024/);
  assert.match(media, /signature:/);
  assert.match(media, /removeManaged/);
  assert.match(profile, /await db\.commit\(\);if\(oldLogo!==p\.logoUrl\)await logoMedia\.removeManaged/);
  assert.match(compose, /\/opt\/salemax\/shared\/media:\/app\/client\/public\/media/);
});

test('profile save preserves only the current tenant managed logo and recipients use the workspace profile route', () => {
  const media = require('../modules/platform/training-center-logo-media');
  const tenant = '5b2e6e83-f4ba-4d17-85d3-21fce3c67eba';
  const logo = `/media/training-center-logos/${tenant}/d7a96a6c-a4cd-4ccb-9a61-214ed37a0f93.webp`;
  assert.equal(media.isManaged(logo, tenant), true);
  assert.equal(media.isManaged(logo, '6f92418d-0612-4f65-8e72-47507b8c752a'), false);
  assert.equal(media.isManaged(logo + '?other=tenant', tenant), false);
  assert.equal(media.isManaged('https://example.test/logo.png', tenant), false);

  const screen = read('client/public/training-courses.js');
  assert.match(screen, /const recipientsPath=endpoint\+'\/report-recipients'/);
});

test('profile save accepts its unchanged tenant logo and rejects an unrelated relative logo URL', async () => {
  const profile = require('../modules/platform/training-center-profile');
  const tenant = '5b2e6e83-f4ba-4d17-85d3-21fce3c67eba';
  const logo = `/media/training-center-logos/${tenant}/d7a96a6c-a4cd-4ccb-9a61-214ed37a0f93.webp`;
  const ctx = { audience: 'tenant', tenant: { id: tenant, status: 'active', categoryKey: 'training_center', categoryVersion: 1 }, membership: { tenantId: tenant, status: 'active', role: 'owner' }, identity: { id: 'identity' }, category: require('../modules/platform/categories').trainingCenter, subscription: { status: 'active', capabilities: ['training.courses'] } };
  let writes = 0;
  const db = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    async query(sql) {
      if (sql.startsWith('SELECT revision,logo_url')) return [[{ revision: 3, logoUrl: logo, crNumber: '', invoicePrefix: 'INV' }]];
      writes++;
      return [{ affectedRows: 1 }];
    },
  };
  const value = { displayNameEn: 'Example center', displayNameAr: '', logoUrl: logo, websiteUrl: '', email: '', phone: '', addressEn: '', addressAr: '', crNumber: '', invoicePrefix: 'INV', googleMapsUrl: '', openingHours: '', aboutEn: '', aboutAr: '', socialLinks: {} };
  const result = await profile.save(db, ctx, 3, value);
  assert.equal(result.logoUrl, logo);
  assert.equal(result.revision, 4);
  assert.equal(writes, 2);
  await assert.rejects(profile.save(db, ctx, 3, { ...value, logoUrl: '/media/other-tenant/logo.png' }), { code: 'INVALID_LOGO_URL' });
});
