'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const groups = require('../modules/platform/qr-inbox-groups');
const { mergeConversationLists } = require('../helper/inbox/chatData');
const { filterChats } = require('../helper/inbox/chatData');

test('direct Inbox excludes synced group metadata while preserving direct chats', () => {
  const rows = [{chat_id:'qrgroup_'+'a'.repeat(48),sender_mobile:'100@g.us',sender_name:'Group'}, {chat_id:'100_200_owner',sender_mobile:'200',sender_name:'Direct'}];
  assert.deepEqual(filterChats(rows).map(row=>row.chat_id), ['100_200_owner']);
  assert.deepEqual(filterChats(rows, {conversationKind:'group'}).map(row=>row.chat_id), ['qrgroup_'+'a'.repeat(48)]);
});

test('group identity retains hyphens and isolates both owners and QR instances', () => {
  assert.equal(groups.isGroupJid('123-456@g.us'), true);
  assert.equal(groups.isGroupJid('123@s.whatsapp.net'), false);
  const ids = [groups.groupChatId('one', 'first', '123-456@g.us'), groups.groupChatId('one', 'second', '123-456@g.us'), groups.groupChatId('two', 'first', '123-456@g.us')];
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every(id => /^qrgroup_[a-f0-9]{48}$/.test(id)));
  assert.throws(() => groups.groupChatId('one', 'first', '123@s.whatsapp.net'));
});

test('admin-only groups reject ordinary members and recognize device-qualified own JID', () => {
  const session = { user: { id: '100:3@s.whatsapp.net', lid: '900@lid' } };
  assert.equal(groups.canPost({ announce: false }, session), true);
  assert.equal(groups.canPost({ announce: true, participants: [{ id: '100@s.whatsapp.net', admin: null }] }, session), false);
  assert.equal(groups.canPost({ announce: true, participants: [{ id: '100@s.whatsapp.net', admin: 'admin' }] }, session), true);
  assert.equal(groups.canPost({ announce: true, participants: [{ id: '900@lid', admin: 'superadmin' }] }, session), true);
});

test('group metadata uses read-only members and never invents a phone number for LID', () => {
  const snapshot = groups.snapshot({ id: '100@g.us', subject: 'Class', participants: [{ id: '900@lid', admin: 'admin' }, { id: '123@s.whatsapp.net', name: 'Member' }] }, 'instance');
  assert.equal(snapshot.participants[0].phone, '');
  assert.equal(snapshot.participants[1].phone, '123');
  assert.equal(snapshot.participants[0].role, 'admin');
});

test('native Inbox name adapter supplies a group title and avatar without saving a contact', () => {
  const row = { chat_id: groups.groupChatId('owner','qr','100@g.us'), sender_name:'🌿 Study group', sender_mobile:'100@g.us', profile:'{}' };
  const display = groups.displayChat(row);
  assert.equal(display.phonebook.name, '🌿 Study group');
  assert.equal(display.phonebook.displayOnly, true);
  assert.equal(display.phonebook.id, undefined);
  assert.equal(JSON.parse(display.profile).profileImage, '/inbox-group-avatar.svg');
  assert.equal(row.profile, '{}');
});

test('group sender names survive text and media display without mutating stored payloads', () => {
  const context = { type: 'text', text: { body: 'Hello 👋' }, group: { jid: '100@g.us', participantName: 'Mary' } };
  const rows = mergeConversationLists({ dbMessages: [{ type: 'text', route: 'INCOMING', msgContext: context, timestamp: 1 }] });
  assert.equal(rows[0].msgContext.text.body, 'Mary\nHello 👋');
  assert.equal(context.text.body, 'Hello 👋');
  assert.equal(groups.isGroup({ msgContext: context }), true);
});

test('group directory metadata requests are scoped, cached and deduplicated', async () => {
  let calls = 0;
  const pool = { query: async (sql, args) => { assert.match(sql, /WHERE uid=\? AND uniqueId=\?/); assert.deepEqual(args, ['owner', 'qr-one']); return [[{ uid: 'owner', uniqueId: 'qr-one' }]]; } };
  const service = groups.createService({ pool, getSession: async () => ({ groupMetadata: async jid => { calls++; return { id: jid, subject: 'Group', participants: [] }; } }) });
  await Promise.all([service.metadata('owner', 'qr-one', '100@g.us'), service.metadata('owner', 'qr-one', '100@g.us')]);
  await service.metadata('owner', 'qr-one', '100@g.us');
  assert.equal(calls, 1);
});

test('group send target rejects forged group identity before transport access', async () => {
  let transports = 0;
  const group = { jid: '100@g.us', instanceId: 'instance' };
  const pool = { query: async () => [[{ chat_id: 'forged', origin_instance_unique_id: 'instance', profile: JSON.stringify({ whatsappGroup: group }) }]] };
  const service = groups.createService({ pool, getSession: async () => { transports++; return {}; } });
  await assert.rejects(service.sendTarget('owner', 'forged'), { code: 'QR_GROUP_NOT_FOUND' });
  assert.equal(transports, 0);
});

test('lead and Phonebook entry points reject group events before database access', async () => {
  const fs = require('node:fs');
  const lead = fs.readFileSync(require.resolve('../helper/pipeline/leadPipeline'), 'utf8');
  const opening = fs.readFileSync(require.resolve('../modules/platform/phonebook-workspace'), 'utf8');
  const common = fs.readFileSync(require.resolve('../helper/inbox/inbox'), 'utf8');
  assert.match(lead, /group_conversation/);
  assert.ok(opening.indexOf("isGroup({...message,chatId})") < opening.indexOf('const db=await pool.getConnection();try{\n const ctx={uid,hash:hash(uid)'));
  assert.ok(common.indexOf("isGroup({ ...msg, chatId:") < common.indexOf('const crmPush = await sendIncomingToCrm'));
});

test('group media detects bytes and rejects executable, oversized and truncated uploads', () => {
  const { inspect } = require('../modules/platform/qr-group-media');
  assert.equal(inspect({ data: Buffer.from('%PDF-1.4\n'), name: '../../report.pdf' }).kind, 'document');
  assert.equal(inspect({ data: Buffer.from('%PDF-1.4\n'), name: '../../report.pdf' }).filename, 'report.pdf');
  assert.equal(inspect({ data: Buffer.from([137,80,78,71,13,10,26,10]), name: 'fake.exe' }).mime, 'image/png');
  assert.throws(() => inspect({ data: Buffer.from('<script>alert(1)</script>'), name: 'file.html' }), { code: 'GROUP_MEDIA_UNSUPPORTED' });
  assert.throws(() => inspect({ data: Buffer.alloc(17 * 1024 * 1024), name: 'file.txt' }), { code: 'GROUP_MEDIA_UNSUPPORTED' });
  assert.throws(() => inspect({ data: Buffer.from('%PDF-1.4'), name: 'file.pdf', truncated: true }), { code: 'GROUP_MEDIA_UNSUPPORTED' });
});
