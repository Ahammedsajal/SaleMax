'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const metaSource = fs.readFileSync(require.resolve('../helper/inbox/meta'), 'utf8');

test('Meta webhook stores only bounded, attributed ad referral fields on the bot-readable message context', () => {
  assert.match(metaSource, /function chatbotAdReferral\(referral\)/);
  assert.match(metaSource, /referral\?\.source_type !== "ad" \|\| !\(referral\.source_id \|\| referral\.ctwa_clid\)/);
  assert.match(metaSource, /source_url: String\(referral\.source_url \|\| ""\)\.slice\(0, 2000\)/);
  assert.match(metaSource, /headline: String\(referral\.headline \|\| ""\)\.slice\(0, 500\)/);
  assert.match(metaSource, /body: String\(referral\.body \|\| ""\)\.slice\(0, 1000\)/);
  assert.match(metaSource, /if \(adReferral\) msgContext\.referral = adReferral/);
});
