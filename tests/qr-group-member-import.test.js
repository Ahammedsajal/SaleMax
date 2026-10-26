'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const service = require('../modules/platform/qr-group-member-import');
const ctx = { uid: 'synthetic-owner', manage: true };
const group = { subject: 'Synthetic group', participants: [{ phone: '+974 5555 0001', name: 'First', role: 'admin' }, { phone: '97455550002', name: 'Second' }, { jid: '900@lid', name: 'Unavailable' }] };
function database({ limit = 10, contacts = [], books = [{ id: 1, name: 'Existing' }], expired = false } = {}) {
  let state = { contacts: structuredClone(contacts), books: structuredClone(books) }, snapshot;
  const calls = [], owner = { id: 1, plan: JSON.stringify({ contact_limit: limit }), plan_expire: Date.now() + (expired ? -1 : 86400000) };
  return { calls, state: () => state, async beginTransaction() { snapshot = structuredClone(state); calls.push('BEGIN'); }, async commit() { calls.push('COMMIT'); }, async rollback() { state = snapshot; calls.push('ROLLBACK'); }, async query(sql, values) {
    calls.push(sql);
    assert.doesNotMatch(sql, /pipeline|lead|broadcast|automation|UPDATE contact|DELETE/i);
    if (sql.includes('FROM user')) { assert.equal(values[0], ctx.uid); return [[owner]]; }
    if (sql.includes('COUNT(*)')) return [[{ count: state.contacts.length }]];
    if (sql.startsWith('SELECT mobile FROM contact')) return [state.contacts.filter(c => c.bookId === values[1])];
    if (sql.startsWith('SELECT id,name FROM phonebook WHERE uid=? AND id=?')) return [[state.books.find(b => b.id === values[1])].filter(Boolean)];
    if (sql.includes('LOWER(TRIM(name))')) return [state.books.filter(b => b.name.toLowerCase() === values[1].toLowerCase())];
    if (sql.startsWith('SELECT id,name FROM phonebook')) return [state.books];
    if (sql.startsWith('INSERT INTO phonebook')) { const id = state.books.length + 1; state.books.push({ id, name: values[1] }); return [{ insertId: id }]; }
    if (sql.startsWith('INSERT INTO contact')) { for (const row of values[0]) { assert.equal(row[0], ctx.uid); state.contacts.push({ bookId: row[1], name: row[3], mobile: row[4] }); } return [{ affectedRows: values[0].length }]; }
    throw Error('UNEXPECTED_QUERY');
  } };
}
test('member normalization uses real phone identities, deduplicates and skips hidden/LID identities', () => {
  const data = service.members({ participants: [...group.participants, { phone: '0097455550001' }, { jid: '97455550003@s.whatsapp.net' }, { phone: '900@lid' }] });
  assert.equal(data.members.length, 3); assert.equal(data.duplicates, 1); assert.equal(data.unavailable, 2);
  assert.equal(data.members[0].name, 'First'); assert.equal(data.members[2].name, '97455550003');
});
test('read-only and foreign-owner contexts cannot preview or import any contacts', async () => {
  const db = { query() { throw Error('DATABASE_MUST_NOT_BE_REACHED'); } };
  for (const denied of [{ ...ctx, manage: false }, { ...ctx, uid: 'foreign' }]) {
    await assert.rejects(service.preview(db, denied, ctx.uid, group), { code: 'GROUP_CONTACT_IMPORT_DENIED' });
    await assert.rejects(service.importMembers(db, denied, ctx.uid, group, {}), { code: 'GROUP_CONTACT_IMPORT_DENIED' });
  }
});
test('preview returns owner books and remaining capacity without writing', async () => {
  const db = database({ contacts: [{ bookId: 1, mobile: '97455550001' }] });
  const result = await service.preview(db, ctx, ctx.uid, group);
  assert.equal(result.remaining, 9); assert.equal(result.members.length, 2); assert.equal(result.unavailable, 1); assert.equal(result.books[0].id, 1);
  assert.ok(db.calls.every(sql => sql.startsWith('SELECT')));
});
test('existing-book import skips formatted duplicate numbers, preserves existing details and is retry safe', async () => {
  const db = database({ contacts: [{ bookId: 1, mobile: '+974 5555 0001', name: 'Existing name' }] });
  const input = { bookId: 1, mobiles: ['97455550001', '97455550002'] };
  const result = await service.importMembers(db, ctx, ctx.uid, group, input);
  assert.equal(result.imported, 1); assert.equal(result.duplicates, 1); assert.equal(db.state().contacts[0].name, 'Existing name');
  const retry = await service.importMembers(db, ctx, ctx.uid, group, input);
  assert.equal(retry.imported, 0); assert.equal(db.state().contacts.length, 2);
  assert.ok(db.calls.indexOf('SELECT id,plan,plan_expire FROM user WHERE uid=? FOR UPDATE') < db.calls.indexOf('SELECT id,name FROM phonebook WHERE uid=? AND id=? FOR UPDATE'));
});
test('new-book creation and contact writes commit atomically; quota failures roll back the new book', async () => {
  const db = database();
  const result = await service.importMembers(db, ctx, ctx.uid, group, { newBookName: 'New members', mobiles: ['97455550002'] });
  assert.equal(result.book.name, 'New members'); assert.equal(db.state().contacts[0].bookId, result.book.id); assert.equal(db.calls.at(-1), 'COMMIT');
  const full = database({ limit: 1 });
  await assert.rejects(service.importMembers(full, ctx, ctx.uid, group, { newBookName: 'Must roll back', mobiles: ['97455550001', '97455550002'] }), { code: 'CONTACT_LIMIT_EXCEEDED' });
  assert.equal(full.state().books.length, 1); assert.equal(full.state().contacts.length, 0); assert.equal(full.calls.at(-1), 'ROLLBACK');
});
test('forged member numbers and invalid selections are rejected before transaction', async () => {
  const db = database();
  for (const mobiles of [[], ['+97455550001'], [123], Array(5001).fill('97455550001')]) await assert.rejects(service.importMembers(db, ctx, ctx.uid, group, { bookId: 1, mobiles }), { code: 'INVALID_MEMBER_SELECTION' });
  await assert.rejects(service.importMembers(db, ctx, ctx.uid, group, { bookId: 1, mobiles: ['97455559999'] }), { code: 'GROUP_MEMBERS_CHANGED' });
  assert.equal(db.calls.length, 0);
});
test('foreign books, duplicate book names and expired plans cannot import', async () => {
  await assert.rejects(service.importMembers(database(), ctx, ctx.uid, group, { bookId: 999, mobiles: ['97455550001'] }), { code: 'PHONEBOOK_NOT_FOUND' });
  await assert.rejects(service.importMembers(database(), ctx, ctx.uid, group, { newBookName: 'existing', mobiles: ['97455550001'] }), { code: 'PHONEBOOK_NAME_EXISTS' });
  await assert.rejects(service.importMembers(database({ expired: true }), ctx, ctx.uid, group, { bookId: 1, mobiles: ['97455550001'] }), { code: 'CONTACT_PLAN_UNAVAILABLE' });
});
