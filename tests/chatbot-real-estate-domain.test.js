'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const { botInput } = require('../modules/platform/chatbot-config');

const pack = getDomainPack('real_estate', 1);
const property = (id, referenceCode, titleEn, titleAr) => ({
  sourceId: id, referenceCode, titleEn, titleAr, propertyType: 'apartment',
  transactionType: 'sale', priceMinor: 12500000, currency: 'QAR', areaSqm: '82.50',
  bedrooms: 2, bathrooms: 1, city: 'Doha', descriptionEn: 'Near the metro.',
  descriptionAr: 'بالقرب من المترو.',
});

test('real-estate pack is versioned, immutable, editable and available to the existing chatbot editor', () => {
  assert.equal(pack.key, 'real_estate');
  assert.equal(pack.version, 1);
  assert.equal(pack.requiresDatabase, true);
  assert.equal(Object.isFrozen(pack.guidedContentDefaults), true);
  assert.ok(pack.guidedContentSchema.groups.some(group => group.fields.some(field => field.path === 'messages.greeting')));
  assert.throws(() => { pack.guidedContentDefaults.messages.greeting.en = 'Shared mutation'; }, TypeError);
  const input = botInput({ name: 'Property guide', engine: 'guided', config: { guidedMode: 'domain_default' } }, 'real_estate', 1);
  assert.equal(input.config.guidedMode, 'domain_default');
  assert.equal(input.config.guidedContent.messages.greeting.en, pack.guidedContentDefaults.messages.greeting.en);
});

test('all existing real-estate category versions resolve their exact guided pack and retain legacy Flow Builder behavior', () => {
  for (const version of [1, 2, 3, 4]) {
    const versionedPack = getDomainPack('real_estate', version);
    assert.equal(versionedPack.key, 'real_estate');
    assert.equal(versionedPack.version, version);
    assert.equal(versionedPack.guidedReply, pack.guidedReply);
    assert.equal(versionedPack.requiresDatabase, true);
    const guided = botInput({ name: `Real Estate v${version}`, engine: 'guided', config: { guidedMode: 'domain_default' } }, 'real_estate', version);
    assert.equal(guided.config.guidedMode, 'domain_default');
    assert.equal(guided.config.guidedContent.messages.greeting.en, pack.guidedContentDefaults.messages.greeting.en);
    const flow = botInput({ name: `Legacy flow v${version}`, engine: 'guided', config: { flowId: 'existing_property_flow' } }, 'real_estate', version);
    assert.equal(flow.config.guidedMode, 'automation_flow');
    assert.equal(flow.config.flowId, 'existing_property_flow');
  }
  assert.equal(getDomainPack('real_estate', 5).key, 'faq_only');
});

test('property facts are loaded by tenant, category version, active state and a bounded listing limit', async () => {
  const calls = [];
  const rowsByTenant = new Map([
    ['tenant-a', [property('a-1', 'RE-A100', 'Harbour Home', 'منزل المرفأ')]],
    ['tenant-b', [property('b-1', 'RE-B200', 'Garden Flat', 'شقة الحديقة')]],
  ]);
  const db = { query: async (sql, args) => {
    calls.push({ sql, args });
    return [rowsByTenant.get(args[0]) || []];
  } };
  const [a] = await pack.loadFacts({ db, tenantId: 'tenant-a' });
  const [b] = await pack.loadFacts({ db, tenantId: 'tenant-b' });
  assert.equal(a.titleEn, 'Harbour Home');
  assert.equal(b.titleEn, 'Garden Flat');
  assert.match(calls[0].sql, /p\.tenant_id=\?/);
  assert.match(calls[0].sql, /p\.status='active'/);
  assert.match(calls[0].sql, /t\.category_key='real_estate'/);
  assert.match(calls[0].sql, /t\.category_version IN \(1,2,3,4\)/);
  assert.match(calls[0].sql, /p\.chatbot_visible=1/);
  assert.match(calls[0].sql, /LIMIT 50/);
  assert.deepEqual(calls.map(call => call.args), [['tenant-a'], ['tenant-b']]);
});

test('same-category businesses get their own configurable bilingual listing replies without cross-tenant facts', () => {
  const factA = property('a-1', 'RE-A100', 'Harbour Home', 'منزل المرفأ');
  const factB = property('b-1', 'RE-B200', 'Garden Flat', 'شقة الحديقة');
  const replyA = pack.guidedReply({ message: 'properties', facts: [factA], config: {
    messages: { greeting: { en: 'Welcome to Harbour Realty.' }, listingsHeading: { en: 'Homes from Harbour Realty' } },
  } });
  const replyB = pack.guidedReply({ message: 'properties', facts: [factB], config: {
    messages: { greeting: { en: 'Welcome to Garden Realty.' }, listingsHeading: { en: 'Garden Realty homes' },
      listingPrompt: { en: 'Send a reference and Garden Realty will help.' } }, display: { showPrice: false },
  } });
  assert.match(replyA.reply, /Homes from Harbour Realty/);
  assert.match(replyA.reply, /Harbour Home/);
  assert.doesNotMatch(replyA.reply, /Garden Flat|RE-B200/);
  assert.match(replyB.reply, /Garden Realty homes/);
  assert.match(replyB.reply, /Garden Flat/);
  assert.match(replyB.reply, /Send a reference and Garden Realty will help/);
  assert.doesNotMatch(replyB.reply, /Harbour Home|RE-A100|QAR/);

  const arabic = pack.guidedReply({ message: 'العقارات', facts: [factA], config: {
    messages: { listingsHeading: { ar: 'منازل المرفأ' } },
  } });
  assert.match(arabic.reply, /منازل المرفأ/);
  assert.match(arabic.reply, /منزل المرفأ/);
  assert.equal(arabic.state.language, 'ar');
});

test('guided listing selection uses only the current fact set and sends viewing requests to staff', () => {
  const fact = property('a-1', 'RE-A100', 'Harbour Home', 'منزل المرفأ');
  const list = pack.guidedReply({ message: 'listings', facts: [fact] });
  const detail = pack.guidedReply({ message: '1', state: list.state, facts: [fact] });
  assert.match(detail.reply, /RE-A100/);
  assert.match(detail.reply, /Harbour Home/);
  assert.doesNotMatch(detail.reply, /booked|reserved|confirmed viewing/i);
  const stale = pack.guidedReply({ message: '1', state: list.state, facts: [] });
  assert.match(stale.reply, /can’t confirm/i);
  const viewing = pack.guidedReply({ message: 'Can I book a viewing?', facts: [fact] });
  assert.equal(viewing.handoff, true);
  assert.match(viewing.reply, /team/i);
  assert.equal(pack.guidedReply({ message: 'Schedule an appointment', facts: [fact] }).handoff, true);
  assert.equal(pack.guidedReply({ message: 'أريد تحديد موعد للمعاينة', facts: [fact] }).handoff, true);
  assert.equal(pack.isGuidedIntent('أريد معاينة العقار'), true);
});
