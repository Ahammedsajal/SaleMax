'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const GRANT_TTL_SECONDS = 120;
const fail = code => Object.assign(new Error(code), { code });
const DEFAULT_MEDIA_ROOT = path.resolve(__dirname, '../../client/public/meta-media');

function ownerMediaDirectory(mediaRoot, ownerUid) {
  if (typeof ownerUid !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(ownerUid)) throw fail('INBOX_MEDIA_OWNER_INVALID');
  const namespace = crypto.createHash('sha256').update(ownerUid).digest('hex');
  return path.resolve(mediaRoot, '.private', namespace);
}

function privateMediaPath(mediaRoot, ownerUid, filename) {
  if (!FILENAME.test(filename || '')) throw fail('INBOX_MEDIA_FILENAME_INVALID');
  const directory = ownerMediaDirectory(mediaRoot, ownerUid);
  const file = path.resolve(directory, filename);
  if (path.dirname(file) !== directory) throw fail('INBOX_MEDIA_FILENAME_INVALID');
  return file;
}

function savePrivateMedia({ mediaRoot = DEFAULT_MEDIA_ROOT, ownerUid, filename, bytes }) {
  if (!Buffer.isBuffer(bytes)) throw fail('INBOX_MEDIA_BYTES_INVALID');
  const file = privateMediaPath(mediaRoot, ownerUid, filename);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return filename;
}

function legacyMediaFilename(value, origin) {
  if (typeof value !== 'string' || !value || typeof origin !== 'string') return null;
  try {
    const base = new URL(origin);
    const target = new URL(value, base);
    const trustedOrigins = new Set([base.origin]);
    for (const candidate of [process.env.FRONTENDURI, process.env.SALEMAX_PLATFORM_ORIGIN,
      'https://7network.live', 'https://www.7network.live', 'https://crm.salemax.qa']) {
      try { if (candidate) trustedOrigins.add(new URL(candidate).origin); } catch {}
    }
    if (!trustedOrigins.has(target.origin) || target.search || target.hash) return null;
    const parts = target.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0] !== 'meta-media') return null;
    const filename = decodeURIComponent(parts[1]);
    return FILENAME.test(filename) && filename !== '.' && filename !== '..' ? filename : null;
  } catch {
    return null;
  }
}

function issueGrant({ key, origin, ownerUid, chatId, filename, actor, agent = false, delegatedSessionId, sessionExpiresAt, now = Date.now() }) {
  if (!key || typeof origin !== 'string' || typeof ownerUid !== 'string' || !ownerUid ||
      typeof chatId !== 'string' || !chatId || !FILENAME.test(filename || '') ||
      !actor || !Number.isSafeInteger(Number(actor.id)) || typeof actor.uid !== 'string' || !actor.uid) {
    throw fail('INBOX_MEDIA_GRANT_INVALID');
  }
  const actorType = agent || actor.isAgent || actor.role === 'agent' ? 'agents' : 'user';
  const issuedAt = Math.floor(now / 1000);
  const grant = jwt.sign({
    purpose: 'inbox-media',
    ownerUid,
    chatId,
    filename,
    actorType,
    actorId: Number(actor.id),
    actorUid: actor.uid,
    ...(typeof actor.password === 'string' ? { credentialHash: crypto.createHash('sha256').update(actor.password).digest('hex') } : {}),
    ...(Number.isSafeInteger(sessionExpiresAt) && sessionExpiresAt > 0 ? { sessionExp: sessionExpiresAt } : {}),
    ...(typeof delegatedSessionId === 'string' && delegatedSessionId ? { delegatedSessionId } : {}),
    iat: issuedAt,
    exp: issuedAt + GRANT_TTL_SECONDS,
  }, key, { algorithm: 'HS256', issuer: '7network', audience: 'inbox-media' });
  const base = new URL(origin);
  return `${base.origin}/api/inbox-media/${grant}`;
}

function signMessageMedia(message, { key, origin, ownerUid, chatId, actor, agent, delegatedSessionId, sessionExpiresAt, mediaRoot }) {
  if (!message || typeof message !== 'object' || !MEDIA_TYPES.has(message.type)) return message;
  const context = message.msgContext;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return message;
  const media = context[message.type];
  const secureLink = signMediaLink(media?.link, { key, origin, ownerUid, chatId, actor, agent, delegatedSessionId, sessionExpiresAt, mediaRoot });
  if (secureLink === media?.link) return message;
  return {
    ...message,
    msgContext: {
      ...context,
      [message.type]: {
        ...media,
        link: secureLink,
      },
    },
  };
}

function signMediaLink(link, options) {
  const filename = legacyMediaFilename(link, options.origin);
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  return filename && safeMediaFile(mediaRoot, options.ownerUid, filename)
    ? issueGrant({ ...options, filename })
    : link;
}

function signConversation(rows, options) {
  return (Array.isArray(rows) ? rows : []).map(row => signMessageMedia(row, {
    ...options,
    chatId: row?.chat_id || options.chatId,
  }));
}

function signChatLastMessages(chats, options) {
  return (Array.isArray(chats) ? chats : []).map(chat => {
    let lastMessage = chat?.last_message;
    const wasString = typeof lastMessage === 'string';
    if (wasString) {
      try { lastMessage = JSON.parse(lastMessage); } catch { return chat; }
    }
    if (!lastMessage || typeof lastMessage !== 'object') return chat;
    const signed = signMessageMedia(lastMessage, {
      ...options,
      chatId: chat.chat_id || options.chatId,
    });
    return signed === lastMessage ? chat : {
      ...chat,
      last_message: wasString ? JSON.stringify(signed) : signed,
    };
  });
}

function contextReferencesFilename(value, filename, origin) {
  let context = value;
  if (typeof context === 'string') {
    try { context = JSON.parse(context); } catch { return false; }
  }
  if (!context || typeof context !== 'object') return false;
  for (const type of MEDIA_TYPES) {
    if (legacyMediaFilename(context[type]?.link, origin) === filename) return true;
  }
  return false;
}

function jsonConversationReferences({ conversationRoot, ownerUid, chatId, filename, origin }) {
  const root = path.resolve(conversationRoot);
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(ownerUid) || typeof chatId !== 'string' ||
      !chatId || chatId.length > 191 || chatId.includes('/') || chatId.includes('\\') || chatId === '.' || chatId === '..') return false;
  const file = path.resolve(root, ownerUid, `${chatId}.json`);
  if (!file.startsWith(`${root}${path.sep}`)) return false;
  try {
    const rootReal = fs.realpathSync(root);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(file).startsWith(`${rootReal}${path.sep}`)) return false;
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(rows) && rows.some(row => contextReferencesFilename(row?.msgContext, filename, origin));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function ownerConversationReferences({ conversationRoot, ownerUid, filename, origin }) {
  const root = path.resolve(conversationRoot);
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(ownerUid)) return false;
  const ownerDirectory = path.resolve(root, ownerUid);
  if (path.dirname(ownerDirectory) !== root) return false;
  try {
    const rootReal = fs.realpathSync(root);
    const directoryStat = fs.lstatSync(ownerDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return false;
    const ownerReal = fs.realpathSync(ownerDirectory);
    if (path.dirname(ownerReal) !== rootReal) return false;
    for (const name of fs.readdirSync(ownerReal)) {
      if (!name.endsWith('.json') || name.includes('/') || name.includes('\\')) continue;
      const file = path.join(ownerReal, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(rows) && rows.some(row => contextReferencesFilename(row?.msgContext, filename, origin))) return true;
    }
    return false;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function hasMediaReference(query, { conversationRoot, ownerUid, chatId, filename, origin = process.env.FRONTENDURI }) {
  const pattern = `/meta-media/${filename}`;
  for (const [table, field] of [['beta_conversation', 'msgContext'], ['beta_chats', 'last_message'], ['chats', 'last_message']]) {
    const rows = await query(`SELECT 1 FROM ${table} WHERE uid=? AND chat_id=? AND LOCATE(?, ${field}) > 0 LIMIT 1`, [ownerUid, chatId, pattern]);
    if (rows.length) return true;
  }
  return jsonConversationReferences({ conversationRoot, ownerUid, chatId, filename, origin });
}

function safeMediaFile(mediaRoot, ownerUid, filename) {
  if (!FILENAME.test(filename || '')) return null;
  const root = path.resolve(mediaRoot);
  let file;
  try { file = privateMediaPath(root, ownerUid, filename); } catch { return null; }
  try {
    const rootReal = fs.realpathSync(root);
    const privateRoot = path.resolve(root, '.private');
    const ownerDirectory = ownerMediaDirectory(root, ownerUid);
    for (const directory of [privateRoot, ownerDirectory]) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const fileReal = fs.realpathSync(file);
    const privateRootReal = fs.realpathSync(privateRoot);
    if (!path.dirname(fileReal).startsWith(`${privateRootReal}${path.sep}`) || !fileReal.startsWith(`${rootReal}${path.sep}`)) return null;
    return fileReal;
  } catch {
    return null;
  }
}

function createRouter({ query, key, mediaRoot, conversationRoot, access = require('./team-inbox-scope') }) {
  const router = require('express').Router();
  router.get('/:grant', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const claims = jwt.verify(req.params.grant, key, {
        algorithms: ['HS256'], issuer: '7network', audience: 'inbox-media',
      });
      if (claims.purpose !== 'inbox-media' || !FILENAME.test(claims.filename || '') ||
          !['user', 'agents'].includes(claims.actorType) || !Number.isSafeInteger(claims.actorId) ||
          typeof claims.actorUid !== 'string' || typeof claims.ownerUid !== 'string' || typeof claims.chatId !== 'string') {
        throw fail('INBOX_MEDIA_GRANT_INVALID');
      }
      if ((claims.sessionExp && claims.sessionExp <= Math.floor(Date.now() / 1000)) ||
          (claims.credentialHash && !/^[a-f0-9]{64}$/.test(claims.credentialHash))) {
        throw fail('INBOX_MEDIA_SESSION_EXPIRED');
      }
      const actorRows = claims.actorType === 'agents'
        ? await query('SELECT * FROM agents WHERE id=? AND uid=? AND owner_uid=? AND role=? AND is_active=1 LIMIT 2', [claims.actorId, claims.actorUid, claims.ownerUid, 'agent'])
        : await query('SELECT * FROM user WHERE id=? AND uid=? LIMIT 2', [claims.actorId, claims.actorUid]);
      if (actorRows.length !== 1) throw fail('INBOX_MEDIA_ACTOR_UNAVAILABLE');
      const actor = { ...actorRows[0], isAgent: claims.actorType === 'agents' };
      if (claims.credentialHash && crypto.createHash('sha256').update(actor.password || '').digest('hex') !== claims.credentialHash) {
        throw fail('INBOX_MEDIA_SESSION_REVOKED');
      }
      await require('./delegated-account-session').assertDelegatedSession(query, {
        ...claims,
        uid: actor.uid,
        email: actor.email,
        password: actor.password,
      });
      const scope = await access.resolveInboxScope(query, actor, 'load_conversation');
      if (scope.uid !== claims.ownerUid) throw fail('INBOX_MEDIA_SCOPE_DENIED');
      await access.authorizeInboxPayload(query, scope, 'load_conversation', { chat: { chat_id: claims.chatId } });
      if (!await hasMediaReference(query, { conversationRoot, ownerUid: claims.ownerUid, chatId: claims.chatId, filename: claims.filename, origin: process.env.FRONTENDURI })) {
        throw fail('INBOX_MEDIA_REFERENCE_REVOKED');
      }
      const file = safeMediaFile(mediaRoot, claims.ownerUid, claims.filename);
      if (!file) throw fail('INBOX_MEDIA_NOT_FOUND');
      return res.sendFile(file, { acceptRanges: true, cacheControl: false, dotfiles: 'allow' }, error => {
        if (error && !res.headersSent) res.status(error.statusCode || 404).end();
      });
    } catch {
      if (!res.headersSent) return res.status(404).end();
    }
  });
  return router;
}

module.exports = {
  GRANT_TTL_SECONDS,
  ownerMediaDirectory,
  privateMediaPath,
  savePrivateMedia,
  legacyMediaFilename,
  issueGrant,
  signMediaLink,
  signMessageMedia,
  signConversation,
  signChatLastMessages,
  hasMediaReference,
  ownerConversationReferences,
  safeMediaFile,
  createRouter,
};
