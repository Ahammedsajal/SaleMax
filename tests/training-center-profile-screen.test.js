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
  assert.match(shell, /training-courses\.js\?v=20261008-prerequisites-edit2/);
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
