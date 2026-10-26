'use strict';
const crypto = require('node:crypto');
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const isGroupJid = value => /^\d+(?:-\d+)?@g\.us$/.test(String(value || ''));
const groupChatId = (uid, instanceId, jid) => {
  if (!uid || !instanceId || !isGroupJid(jid)) throw Object.assign(Error('INVALID_GROUP'), { code: 'INVALID_GROUP', status: 400 });
  return 'qrgroup_' + crypto.createHash('sha256').update(JSON.stringify([uid, instanceId, jid])).digest('hex').slice(0, 48);
};
const profile = chat => parse(chat?.profile).whatsappGroup || null;
const isGroup = value => !!(String(value?.chat_id || value?.chatId || '').startsWith('qrgroup_') ||
  isGroupJid(value?.key?.remoteJid) || isGroupJid(value?.msgContext?.group?.jid) || isGroupJid(profile(value)?.jid));
const cleanJid = value => String(value || '').replace(/:\d+(?=@)/, '');
function displayChat(chat) {
  if (!isGroup(chat)) return chat;
  const saved = parse(chat.profile);
  // Display-only adapter for the legacy list's name slot; never a saved contact.
  return { ...chat, isGroup: true, phonebook: { name: chat.sender_name || saved.whatsappGroup?.subject || 'WhatsApp group', displayOnly: true, isGroup: true },
    profile: JSON.stringify({ ...saved, profileImage: saved.profileImage || '/inbox-group-avatar.svg' }) };
}
const fail = (code, status = 409) => { throw Object.assign(Error(code), { code, status }); };
const timeout = (promise, milliseconds = 12000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('QR_GROUP_TIMEOUT'), { code: 'QR_GROUP_TIMEOUT' })), milliseconds); })]).finally(() => clearTimeout(timer));
};

function snapshot(metadata, instanceId, nameFor = () => '') {
  if (!isGroupJid(metadata?.id)) fail('INVALID_GROUP', 400);
  return {
    version: 1, jid: metadata.id, instanceId, subject: String(metadata.subject || 'WhatsApp group').slice(0, 256),
    description: String(metadata.desc || '').slice(0, 4000), announce: !!metadata.announce, restricted: !!metadata.restrict,
    owner: metadata.owner || '', createdAt: Number(metadata.creation) || null, updatedAt: Date.now(),
    participants: (metadata.participants || []).slice(0, 5000).map(member => ({
      jid: cleanJid(member.id), phone: String(member.phoneNumber || (String(member.id).endsWith('@s.whatsapp.net') ? cleanJid(member.id) : '')).split('@')[0],
      name: String(nameFor(member.id) || member.name || member.notify || '').slice(0, 256), role: member.admin || 'member',
      ...(member.lid ? { lid: cleanJid(member.lid) } : {}),
    })),
  };
}

function canPost(metadata, session) {
  if (!metadata?.announce) return true;
  const self = new Set([session?.user?.id, session?.user?.lid, session?.authState?.creds?.me?.id, session?.authState?.creds?.me?.lid].filter(Boolean).map(cleanJid));
  return (metadata.participants || []).some(member => [member.id, member.jid, member.phoneNumber, member.lid].some(id => self.has(cleanJid(id))) && ['admin', 'superadmin'].includes(member.admin || member.role));
}

function createService({ pool, getSession, nameFor = () => '', now = () => Date.now() }) {
  const cache = new Map(), pending = new Map();
  const query = async (sql, args) => (await pool.query(sql, args))[0];
  const keyFor = (uid, instanceId, jid) => groupChatId(uid, instanceId, jid);
  async function instance(uid, instanceId) {
    const [row] = await query('SELECT * FROM instance WHERE uid=? AND uniqueId=? LIMIT 1', [uid, instanceId]);
    if (!row) fail('QR_INSTANCE_NOT_FOUND', 404);
    return row;
  }
  async function metadata(uid, instanceId, jid, force = false) {
    const key = keyFor(uid, instanceId, jid), cached = cache.get(key);
    if (!force && cached && cached.expires > now()) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const load = (async () => {
      await instance(uid, instanceId);
      const session = await getSession(instanceId);
      if (!session?.groupMetadata) fail('QR_INSTANCE_OFFLINE');
      const value = await timeout(session.groupMetadata(jid));
      if (value?.id !== jid) fail('QR_GROUP_NOT_FOUND', 404);
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: now() + 300000 });
      return value;
    })();
    pending.set(key, load);
    try { return await load; } finally { pending.delete(key); }
  }
  async function store({ uid, instanceId, metadata: details, message = null, session }) {
    const chatId = keyFor(uid, instanceId, details.id);
    const group = snapshot(details, instanceId, jid => nameFor(instanceId, jid));
    const db = await pool.getConnection();
    const lock = 'group:' + crypto.createHash('sha256').update(chatId).digest('hex').slice(0, 56);
    let held = false;
    try {
      const [[claim]] = await db.query('SELECT GET_LOCK(?,5) AS acquired', [lock]);
      if (Number(claim.acquired) !== 1) fail('QR_GROUP_BUSY');
      held = true;
      const [[chat]] = await db.query('SELECT * FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1', [uid, chatId]);
      const oldProfile = parse(chat?.profile), oldGroup = oldProfile.whatsappGroup;
      const previousNames = new Map((oldGroup?.participants || []).map(member => [member.jid, member.name]));
      for (const member of group.participants) if (!member.name) member.name = previousNames.get(member.jid) || '';
      if (message?.msgContext?.group?.participantJid) {
        const participant = group.participants.find(member => member.jid === cleanJid(message.msgContext.group.participantJid));
        if (participant && message.senderName && message.senderName !== 'NA') participant.name = message.senderName;
      }
      const values = { sender_name: group.subject, sender_mobile: group.jid, origin: 'qr',
        origin_instance_unique_id: instanceId, origin_instance_id: JSON.stringify({ id: session?.user?.id || session?.authState?.creds?.me?.id || '' }),
        profile: JSON.stringify({ ...oldProfile, isGroup: true, whatsappGroup: group }),
      };
      if (message) {
        const previousMessage = parse(chat?.last_message);
        const incomingTimestamp = Number(message.timestamp) || Date.parse(message.timestamp || '') / 1000 || 0;
        const previousTimestamp = Number(previousMessage?.timestamp) || Date.parse(previousMessage?.timestamp || '') / 1000 || 0;
        values.last_message = !previousTimestamp || incomingTimestamp >= previousTimestamp
          ? JSON.stringify(message)
          : chat.last_message;
        if (message.route === 'INCOMING') values.unread_count = Number(chat?.unread_count || 0) + 1;
      }
      if (oldProfile.profileImage) group.photo = oldProfile.profileImage;
      if (chat) await db.query('UPDATE beta_chats SET ? WHERE uid=? AND chat_id=?', [values, uid, chatId]);
      else await db.query('INSERT INTO beta_chats SET ?', [{ ...values, uid, chat_id: chatId, unread_count: values.unread_count || 0, assigned_agent: null, createdAt: new Date() }]);
      return { chatId, group };
    } finally {
      if (held) await db.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
      db.release();
    }
  }
  async function record({ uid, instanceId, jid, message }) {
    const session = await getSession(instanceId);
    let details;
    try { details = await metadata(uid, instanceId, jid); }
    catch {
      const [chat] = await query('SELECT profile FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1', [uid, keyFor(uid, instanceId, jid)]);
      const prior = profile(chat);
      details = { id: jid, subject: prior?.subject || 'WhatsApp group', desc: prior?.description, announce: prior?.announce,
        participants: (prior?.participants || []).map(member => ({ id: member.jid, name: member.name, admin: member.role })) };
    }
    return store({ uid, instanceId, metadata: details, message, session });
  }
  async function sync(uid, instanceId) {
    await instance(uid, instanceId);
    const session = await getSession(instanceId);
    if (!session?.groupFetchAllParticipating) fail('QR_INSTANCE_OFFLINE');
    const groups = await timeout(session.groupFetchAllParticipating(), 25000);
    let count = 0;
    for (const group of Object.values(groups || {})) {
      if (!isGroupJid(group.id)) continue;
      cache.set(keyFor(uid, instanceId, group.id), { value: group, expires: now() + 300000 });
      await store({ uid, instanceId, metadata: group, session }); count++;
    }
    return { count };
  }
  async function stored(uid, chatId) {
    const [chat] = await query('SELECT * FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1', [uid, chatId]);
    const group = profile(chat);
    if (!chat || !group || keyFor(uid, group.instanceId, group.jid) !== chatId || chat.origin_instance_unique_id !== group.instanceId) fail('QR_GROUP_NOT_FOUND', 404);
    await instance(uid, group.instanceId);
    return { chat, group };
  }
  async function details(uid, chatId, refresh = false) {
    const { chat, group } = await stored(uid, chatId);
    let stale = false, current = group;
    try {
      const meta = await metadata(uid, group.instanceId, group.jid, refresh), session = await getSession(group.instanceId);
      current = (await store({ uid, instanceId: group.instanceId, metadata: meta, session })).group;
      try {
        const photo = await timeout(session.profilePictureUrl(group.jid, 'image'), 5000);
        if (typeof photo === 'string' && photo.startsWith('https://')) {
          current.photo = photo;
          await query('UPDATE beta_chats SET profile=JSON_SET(COALESCE(profile,\'{}\'),\'$.profileImage\',?) WHERE uid=? AND chat_id=?', [photo, uid, chatId]);
        }
      } catch { /* Group photos are optional and may be private. */ }
    } catch { stale = true; }
    return { chatId, group: current, stale, chat };
  }
  async function sendTarget(uid, chatId) {
    const { group } = await stored(uid, chatId), session = await getSession(group.instanceId);
    if (!session?.sendMessage) fail('QR_INSTANCE_OFFLINE');
    const meta = await metadata(uid, group.instanceId, group.jid, true);
    if (!canPost(meta, session)) fail('QR_GROUP_ADMINS_ONLY', 403);
    return { jid: group.jid, session, instanceId: group.instanceId, metadata: meta };
  }
  return { metadata, store, record, sync, stored, details, sendTarget, query };
}
let defaultService;
function service() {
  if (!defaultService) defaultService = createService({ pool: require('../../database/config').promise(),
    getSession: id => require('../../helper/addon/qr').getSession(id),
    nameFor: (id, jid) => require('../../helper/addon/qr').getCachedQrContactName(id, jid),
  });
  return defaultService;
}
module.exports = { isGroupJid, isGroup, groupChatId, profile, cleanJid, snapshot, canPost, createService, service, displayChat };
