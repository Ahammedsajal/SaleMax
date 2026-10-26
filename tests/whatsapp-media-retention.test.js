'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMediaRetention, references, localReference, expiredMedia, GROUP_MS, DIRECT_MS } = require('../helper/maintenance/whatsappMediaRetention');

const time = Date.UTC(2026, 9, 26, 12);
const message = (id, filename, age, group = false, directory = 'meta-media') => ({ id, chat_id: group ? 'qrgroup_synthetic' : 'synthetic_direct', origin: 'qr', type: 'image', timestamp: (time - age) / 1000, createdAt: new Date(time - age), msgContext: JSON.stringify({ image: { link: `https://7network.live/${directory}/${filename}`, caption: 'Preserve this caption' } }) });

async function fixture(t, rows, protectedValues = [], { queryFailure = false, fresh = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '7network-media-retention-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'meta-media')); await fs.mkdir(path.join(root, 'media'));
  const queries = [];
  const query = async (sql, values) => {
    queries.push(sql);
    assert.doesNotMatch(sql, /\b(DELETE|UPDATE|INSERT|ALTER|DROP)\b/i, 'retention must never mutate message or business rows');
    if (sql.startsWith('SELECT id,chat_id,type')) return rows.filter(row => row.id > values[0]);
    if (sql.includes('information_schema')) return [{ TABLE_NAME: 'campaigns', COLUMN_NAME: 'payload' }];
    if (sql.includes('FROM `campaigns`')) { if (queryFailure) throw Error('SYNTHETIC_DB_FAILURE'); return protectedValues.map(value => ({ payload: value })); }
    if (sql.startsWith('SELECT id FROM beta_conversation')) return fresh;
    throw Error('UNEXPECTED_QUERY');
  };
  const write = async (name, age, directory = 'meta-media') => { const file = path.join(root, directory, name); await fs.writeFile(file, Buffer.alloc(7)); const at = new Date(time - age); await fs.utimes(file, at, at); return file; };
  const service = createMediaRetention({ query, publicRoot: root, conversationRoot: path.join(root, 'legacy'), now: () => time });
  return { root, service, write, queries };
}

test('48-hour groups and 28-day direct media expire independently; shared/new media survives', async t => {
  const rows = [message(1, 'group-old.jpg', GROUP_MS + 1e4, true), message(2, 'group-young.jpg', GROUP_MS - 1e4, true), message(3, 'direct-old.jpg', DIRECT_MS + 1e4), message(4, 'direct-young.jpg', DIRECT_MS - 1e4), message(5, 'shared.jpg', DIRECT_MS + 1e4, true), message(6, 'shared.jpg', 3600000), message(7, 'late-download.jpg', GROUP_MS + 1e4, true)];
  const f = await fixture(t, rows);
  for (const row of rows) await f.write(JSON.parse(row.msgContext).image.link.split('/').pop(), DIRECT_MS + 2e4);
  await f.write('late-download.jpg', 1000);
  const dry = await f.service.run({ dryRun: true });
  assert.equal(dry.deletedFiles, 0); assert.equal(dry.eligible.group, 1); assert.equal(dry.eligible.direct, 1);
  const result = await f.service.run();
  assert.equal(result.deletedFiles, 2);
  await assert.rejects(fs.stat(path.join(f.root, 'meta-media/group-old.jpg')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.root, 'meta-media/direct-old.jpg')), { code: 'ENOENT' });
  for (const name of ['group-young.jpg', 'direct-young.jpg', 'shared.jpg', 'late-download.jpg']) assert.ok(await fs.stat(path.join(f.root, 'meta-media', name)));
});

test('campaign references and media library originals survive; only old meta-media orphans expire', async t => {
  const f = await fixture(t, [message(1, 'campaign.jpg', DIRECT_MS + 1000)], [JSON.stringify({ carousel: { image: 'https://7network.live/meta-media/campaign.jpg' } })]);
  await f.write('campaign.jpg', DIRECT_MS + 2000); await f.write('orphan.jpg', DIRECT_MS + 2000); await f.write('recent-orphan.jpg', 1000); await f.write('library.jpg', DIRECT_MS + 2000, 'media');
  const result = await f.service.run();
  assert.equal(result.deletedFiles, 1); assert.equal(result.protectedFiles, 1);
  assert.ok(await fs.stat(path.join(f.root, 'meta-media/campaign.jpg')));
  assert.ok(await fs.stat(path.join(f.root, 'media/library.jpg')));
});

test('failed reference scans delete nothing; concurrent new references are protected', async t => {
  const f = await fixture(t, [message(1, 'old.jpg', GROUP_MS + 1000, true)], [], { queryFailure: true });
  const file = await f.write('old.jpg', GROUP_MS + 2000);
  await assert.rejects(f.service.run(), /SYNTHETIC_DB_FAILURE/); assert.ok(await fs.stat(file));
  const concurrent = await fixture(t, [message(1, 'old.jpg', GROUP_MS + 1000, true)], [], { fresh: [{ id: 2 }] });
  await concurrent.write('old.jpg', GROUP_MS + 2000);
  const result = await concurrent.service.run(); assert.equal(result.deletedFiles, 0); assert.equal(result.changedFiles, 1);
});

test('file safety rejects external URLs, traversal, symlinks and unknown message age; batches are bounded', async t => {
  assert.equal(localReference('https://external.invalid/meta-media/file.jpg'), null);
  assert.equal(localReference('/meta-media/%2e%2e%2fsecret'), null);
  assert.equal(localReference('/meta-media/.secret'), null);
  assert.deepEqual([...references('https://external.invalid/meta-media/file.jpg').keys()], []);
  assert.deepEqual([...references(JSON.stringify({ link: '/meta-media/file.jpg' })).keys()], ['meta-media/file.jpg']);
  const f = await fixture(t, [{ ...message(1, 'unknown.jpg', DIRECT_MS), timestamp: '', createdAt: null }, message(2, 'old-a.jpg', GROUP_MS + 1000, true), message(3, 'old-b.jpg', GROUP_MS + 1000, true)]);
  await f.write('unknown.jpg', DIRECT_MS + 2000); await f.write('old-a.jpg', GROUP_MS + 2000); await f.write('old-b.jpg', GROUP_MS + 2000);
  const outside = path.join(f.root, 'outside.jpg'); await fs.writeFile(outside, 'keep'); await fs.symlink(outside, path.join(f.root, 'meta-media/symlink.jpg'));
  const result = await f.service.run({ maxFiles: 1 });
  assert.equal(result.deletedFiles, 1); assert.equal(result.deferredFiles, 1);
  assert.ok(await fs.stat(path.join(f.root, 'meta-media/unknown.jpg'))); assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
});

test('legacy media references protect unexpired files and malformed history prevents deletion', async t => {
  const f = await fixture(t, []);
  await f.write('legacy.jpg', DIRECT_MS + 1000);
  await fs.mkdir(path.join(f.root, 'legacy'));
  const file = path.join(f.root, 'legacy', 'chat.json');
  await fs.writeFile(file, JSON.stringify([message(1, 'legacy.jpg', 1000)]));
  assert.equal((await f.service.run()).deletedFiles, 0);
  await fs.writeFile(file, '{malformed');
  await assert.rejects(f.service.run(), SyntaxError);
  assert.ok(await fs.stat(path.join(f.root, 'meta-media', 'legacy.jpg')));
});

test('expired media displays a caption and expiry notice without rewriting stored history', () => {
  const row = message(1, 'synthetic-retention-missing-file.jpg', GROUP_MS + 1000, true);
  row.timestamp = (Date.now() - GROUP_MS - 10000) / 1000; row.createdAt = null;
  const original = JSON.stringify(row);
  assert.equal(expiredMedia(row), true);
  const { mergeConversationLists } = require('../helper/inbox/chatData');
  const [display] = mergeConversationLists({ dbMessages: [row] });
  assert.equal(display.type, 'text'); assert.match(display.msgContext.text.body, /Preserve this caption/); assert.match(display.msgContext.text.body, /48 hours/);
  assert.equal(JSON.stringify(row), original);
});
