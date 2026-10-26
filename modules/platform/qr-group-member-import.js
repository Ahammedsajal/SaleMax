'use strict';
const fail = (code, status = 400) => { throw Object.assign(Error(code), { code, status }); };
function phone(value) {
  if (typeof value !== 'string' || /@lid$/.test(value)) return '';
  const raw = value.replace(/@s\.whatsapp\.net$/, '').replace(/[+\s().-]/g, '').replace(/^00/, '');
  return /^[1-9]\d{6,14}$/.test(raw) ? raw : '';
}
function members(group) {
  const unique = new Map(); let unavailable = 0, duplicates = 0;
  for (const member of (group.participants || []).slice(0, 5000)) {
    const mobile = phone(member.phone) || phone(String(member.jid).endsWith('@s.whatsapp.net') ? member.jid : '');
    if (!mobile) { unavailable++; continue; }
    if (unique.has(mobile)) { duplicates++; continue; }
    unique.set(mobile, { mobile, name: String(member.name || mobile).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || mobile, role: member.role || 'member' });
  }
  return { members: [...unique.values()], unavailable, duplicates, total: group.participants?.length || 0 };
}
function assertManage(ctx, ownerUid) {
  if (!ctx?.manage || !ownerUid || ctx.uid !== ownerUid) fail('GROUP_CONTACT_IMPORT_DENIED', 403);
}
async function preview(db, ctx, ownerUid, group) {
  assertManage(ctx, ownerUid);
  const [books] = await db.query('SELECT id,name FROM phonebook WHERE uid=? ORDER BY name,id', [ctx.uid]);
  const [[owner]] = await db.query('SELECT plan,plan_expire FROM user WHERE uid=?', [ctx.uid]);
  const [[count]] = await db.query('SELECT COUNT(*) AS count FROM contact WHERE uid=?', [ctx.uid]);
  let plan; try { plan = JSON.parse(owner?.plan || '{}'); } catch { plan = {}; }
  const limit = Number(plan.contact_limit ?? plan.contacts ?? 0);
  return { ...members(group), books, remaining: owner && Number(owner.plan_expire) > Date.now() && Number.isFinite(limit) ? Math.max(0, limit - Number(count.count)) : 0, suggestedName: String(group.subject || 'WhatsApp group').slice(0, 200) };
}
async function importMembers(db, ctx, ownerUid, group, input) {
  assertManage(ctx, ownerUid);
  const data = members(group);
  if (!Array.isArray(input?.mobiles) || !input.mobiles.length || input.mobiles.length > 5000 || input.mobiles.some(value => typeof value !== 'string' || phone(value) !== value)) fail('INVALID_MEMBER_SELECTION');
  const selected = [...new Set(input.mobiles)], available = new Map(data.members.map(member => [member.mobile, member]));
  if (selected.some(value => !available.has(value))) fail('GROUP_MEMBERS_CHANGED', 409);
  const bookId = input.bookId == null || input.bookId === '' ? null : Number(input.bookId);
  const newName = typeof input.newBookName === 'string' ? input.newBookName.trim() : '';
  if ((bookId !== null && (!Number.isSafeInteger(bookId) || bookId < 1 || newName)) || (bookId === null && (!newName || newName.length > 200 || /[\u0000-\u001f]/.test(newName)))) fail('INVALID_TARGET_PHONEBOOK');
  await db.beginTransaction();
  try {
    // The owner row serializes this importer across target books and makes
    // quota checks atomic with the existing rule-based Phonebook writer.
    const [[owner]] = await db.query('SELECT id,plan,plan_expire FROM user WHERE uid=? FOR UPDATE', [ctx.uid]);
    let plan; try { plan = JSON.parse(owner?.plan || '{}'); } catch { plan = {}; }
    const limit = Number(plan.contact_limit ?? plan.contacts ?? 0);
    if (!owner || !Number.isFinite(Number(owner.plan_expire)) || Number(owner.plan_expire) <= Date.now() || !Number.isFinite(limit) || limit <= 0) fail('CONTACT_PLAN_UNAVAILABLE', 403);
    let book;
    if (bookId !== null) {
      [[book]] = await db.query('SELECT id,name FROM phonebook WHERE uid=? AND id=? FOR UPDATE', [ctx.uid, bookId]);
      if (!book) fail('PHONEBOOK_NOT_FOUND', 404);
    } else {
      const [existing] = await db.query('SELECT id FROM phonebook WHERE uid=? AND LOWER(TRIM(name))=LOWER(?) FOR UPDATE', [ctx.uid, newName]);
      if (existing.length) fail('PHONEBOOK_NAME_EXISTS', 409);
      const [created] = await db.query('INSERT INTO phonebook(uid,name) VALUES (?,?)', [ctx.uid, newName]);
      book = { id: created.insertId, name: newName };
    }
    const [existingContacts] = await db.query('SELECT mobile FROM contact WHERE uid=? AND phonebook_id=? FOR UPDATE', [ctx.uid, book.id]);
    const existing = new Set(existingContacts.map(contact => phone(contact.mobile)).filter(Boolean));
    const additions = selected.filter(value => !existing.has(value)).map(value => available.get(value));
    const [[count]] = await db.query('SELECT COUNT(*) AS count FROM contact WHERE uid=?', [ctx.uid]);
    if (Number(count.count) + additions.length > limit) fail('CONTACT_LIMIT_EXCEEDED', 409);
    for (let offset = 0; offset < additions.length; offset += 100) {
      const values = additions.slice(offset, offset + 100).map(member => [ctx.uid, book.id, book.name, member.name, member.mobile, '', '', '', '', '']);
      await db.query('INSERT INTO contact(uid,phonebook_id,phonebook_name,name,mobile,var1,var2,var3,var4,var5) VALUES ?', [values]);
    }
    await db.commit();
    return { book: { id: book.id, name: book.name }, imported: additions.length, duplicates: selected.length - additions.length, selected: selected.length, unavailable: data.unavailable };
  } catch (error) { await db.rollback(); throw error; }
}
module.exports = { phone, members, assertManage, preview, importMembers };
