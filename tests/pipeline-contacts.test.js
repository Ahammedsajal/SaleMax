const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contacts = require('../helper/pipeline/leadPipeline');

test('contact email matching is normalized and validated before database access', async () => {
  assert.equal(contacts.normalizeEmail(' Learner@Example.QA '), 'learner@example.qa');
  assert.equal(contacts.normalizeEmail(''), null);
  assert.throws(() => contacts.normalizeEmail('not-an-email'), { status: 400 });
  assert.deepEqual(await contacts.findContactMatches({ uid: 'workspace', pool: { query: async () => { throw new Error('unexpected database access'); } } }), []);
});

test('contact matches query exact identifiers inside the tenant and return bounded suggestions', async () => {
  let seen;
  const pool = { async query(sql, values) { seen = { sql, values }; return [[{ id: 'contact-id', name: 'Learner', phone: '+97455123456', email: 'learner@example.qa' }]]; } };
  const rows = await contacts.findContactMatches({ uid: 'workspace', phone: '+974 5512 3456', email: 'Learner@Example.QA', pool });
  assert.equal(rows.length, 1);
  assert.match(seen.sql, /uid_hash = \? AND \(normalized_phone = \? OR normalized_email = \?\)/);
  assert.match(seen.sql, /LIMIT 10/);
  assert.deepEqual(seen.values, [require('node:crypto').createHash('sha256').update('workspace').digest('hex'), '+97455123456', 'learner@example.qa']);
  await contacts.findContactMatches({ uid: 'workspace', phone: '+97455123456', role: 'agent', agentId: 17, pool });
  assert.match(seen.sql, /EXISTS \(SELECT 1 FROM pipeline_leads l/);
  assert.equal(seen.values.at(-1), 17);
  await assert.rejects(contacts.findContactMatches({ uid: 'workspace', phone: '+97455123456', role: 'accountant', pool }), { status: 403 });
  await assert.rejects(contacts.findContactMatches({ uid: 'workspace', phone: 'short', pool }), { status: 400 });
});

test('existing pipeline add-opportunity screen offers contact reuse and separate learners in English and Arabic', () => {
  const root = path.join(__dirname, '../client/public/pipeline');
  const screen = fs.readFileSync(path.join(root, 'pipeline.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(screen, /learnerName/);
  assert.match(screen, /\/contacts\/matches\?/);
  assert.match(screen, /contactId/);
  assert.match(screen, /Create a separate contact \/ learner/);
  assert.match(screen, /إنشاء جهة اتصال \/ متعلم مستقل/);
  assert.match(html, /pipeline\.js\?v=11/);
});

test('follow-up query and action inputs fail closed before touching the database', async () => {
  const pool = { query: async () => { throw new Error('unexpected database access'); } };
  await assert.rejects(contacts.getFollowUps({ uid: 'workspace', role: 'accountant', pool }), { status: 403 });
  await assert.rejects(contacts.getFollowUps({ uid: 'workspace', role: 'owner', period: 'all-ish', pool }), { status: 400 });
  await assert.rejects(contacts.getFollowUps({ uid: 'workspace', role: 'owner', page: 0, pool }), { status: 400 });
  await assert.rejects(contacts.getFollowUps({ uid: 'workspace', role: 'owner', limit: 101, pool }), { status: 400 });
  await assert.rejects(contacts.resolveFollowUp({ uid: 'workspace', id: 'lead', action: 'delete', pool }), { status: 400 });
  await assert.rejects(contacts.resolveFollowUp({ uid: 'workspace', id: 'lead', action: 'reschedule', at: 'not-a-date', pool }), { status: 400 });
  const reports = fs.readFileSync(path.join(__dirname, '../client/public/pipeline/reports.js'), 'utf8');
  assert.match(reports, /\/api\/pipeline\/follow-ups\?/);
  assert.match(reports, /expectedDueAt/);
  assert.match(reports, /متابعات/);
});
