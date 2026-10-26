'use strict';
const groups = require('./qr-inbox-groups');
const access = require('./team-inbox-scope');
module.exports = function createRouter({ pool, authenticate, origin, groupService = groups.service() }) {
  const express = require('express'), router = express.Router();
  const query = async (sql, args) => (await pool.query(sql, args))[0];
  const fail = (code, status = 403) => { throw Object.assign(Error(code), { code, status }); };
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const syncTimes = new Map();
  router.use(express.json({ limit: '128kb', strict: true }));
  router.use(authenticate);
  router.use((req, res, next) => {
    Promise.resolve().then(async () => {
      res.set('Cache-Control', 'private, no-store');
      if (!['GET', 'HEAD'].includes(req.method) && !require('./request-origin').matches(req, origin)) fail('ORIGIN_DENIED');
      const session = req.featureSession;
      if (!session?.actor || !session.ownerUid) fail('AUTH_REQUIRED', 401);
      const scope = await access.resolveInboxScope(query, { ...session.actor, isAgent: session.agent }, ['/send', '/media'].includes(req.path) ? 'send_chat_message' : 'get_chat_list');
      if (!scope.canonical && session.agent) { scope.uid = session.ownerUid; scope.assignedOnly = true; scope.actorUid = session.actor.uid; scope.actorLegacyId = session.actor.id; }
      req.groupScope = scope;
      next();
    }).catch(next);
  });
  async function conversation(req) {
    const chatId = String(req.body?.chatId || req.query.chatId || '');
    if (!/^qrgroup_[a-f0-9]{48}$/.test(chatId)) fail('INVALID_GROUP', 400);
    const value = await groupService.stored(req.groupScope.uid, chatId);
    if (!access.filterAssignedChats([value.chat], req.groupScope).length) fail('GROUP_ACCESS_DENIED');
    return value;
  }
  async function refreshReply(req, chat) {
    const session = await req.featureSession.refresh();
    if (!session?.actor) fail('AUTH_REQUIRED', 401);
    const scope = await access.resolveInboxScope(query, { ...session.actor, isAgent: session.agent }, 'send_chat_message');
    if (!scope.canonical && session.agent) Object.assign(scope, { uid: session.ownerUid, assignedOnly: true, actorUid: session.actor.uid, actorLegacyId: session.actor.id });
    if (scope.uid !== req.groupScope.uid || !access.filterAssignedChats([chat], scope).length) fail('GROUP_ACCESS_DENIED');
  }
  async function importContext(req, db) {
    const session = await req.featureSession.refresh();
    const scope = await access.resolveInboxScope(query, { ...session.actor, isAgent: session.agent }, 'get_chat_list');
    if (!scope.canonical && session.agent) Object.assign(scope, { uid: session.ownerUid, assignedOnly: true, actorUid: session.actor.uid, actorLegacyId: session.actor.id });
    const { chat } = await groupService.stored(scope.uid, String(req.body?.chatId || req.query.chatId || ''));
    if (scope.uid !== req.groupScope.uid || !access.filterAssignedChats([chat], scope).length) fail('GROUP_ACCESS_DENIED');
    const ctx = await require('./phonebook-workspace').sessionContext(db, session);
    require('./qr-group-member-import').assertManage(ctx, scope.uid);
    return ctx;
  }
  router.get('/member-import', wrap(async (req, res) => {
    const { chat } = await conversation(req);
    const db = await pool.getConnection();
    try {
      await importContext(req, db);
      const data = await groupService.details(req.groupScope.uid, chat.chat_id, true);
      if (data.stale) fail('GROUP_REFRESH_REQUIRED', 409);
      const ctx = await importContext(req, db);
      res.json({ success: true, ...await require('./qr-group-member-import').preview(db, ctx, req.groupScope.uid, data.group) });
    } finally { db.release(); }
  }));
  router.post('/member-import', wrap(async (req, res) => {
    const { chat } = await conversation(req);
    const db = await pool.getConnection();
    try {
      await importContext(req, db);
      const data = await groupService.details(req.groupScope.uid, chat.chat_id, true);
      if (data.stale) fail('GROUP_REFRESH_REQUIRED', 409);
      const ctx = await importContext(req, db);
      const result = await require('./qr-group-member-import').importMembers(db, ctx, req.groupScope.uid, data.group, req.body);
      res.json({ success: true, ...result });
    } finally { db.release(); }
  }));
  router.get('/', wrap(async (req, res) => {
    const rows = await query("SELECT * FROM beta_chats WHERE uid=? AND chat_id LIKE 'qrgroup_%' ORDER BY id DESC LIMIT 1000", [req.groupScope.uid]);
    const permitted = access.filterAssignedChats(rows, req.groupScope);
    const instances = !req.groupScope.canonical && req.featureSession.agent ? [] : access.filterQrInstances(await query('SELECT id,uniqueId,title,number,status FROM instance WHERE uid=? ORDER BY id', [req.groupScope.uid]), req.groupScope);
    const term = String(req.query.search || '').toLowerCase();
    res.json({ success: true, groups: permitted.filter(row => !term || String(row.sender_name).toLowerCase().includes(term)).map(row => {
      const group = groups.profile(row);
      return { chatId: row.chat_id, subject: group?.subject || row.sender_name, instanceId: row.origin_instance_unique_id,
        members: group?.participants?.length || 0, unread: Number(row.unread_count || 0) };
    }), instances, noLeadCapture: true, automation: false });
  }));
  router.post('/sync', wrap(async (req, res) => {
    if (!req.groupScope.canonical && req.featureSession.agent) fail('GROUP_ACCESS_DENIED');
    const instanceId = String(req.body?.instanceId || '');
    const rows = await query('SELECT id,uniqueId,title,number,status FROM instance WHERE uid=? AND uniqueId=?', [req.groupScope.uid, instanceId]);
    if (!rows.length || !access.filterQrInstances(rows, req.groupScope).length) fail('GROUP_ACCESS_DENIED');
    const key = `${req.groupScope.uid}:${instanceId}`;
    if (Date.now() - (syncTimes.get(key) || 0) < 60000) fail('GROUP_SYNC_RATE_LIMIT', 429);
    syncTimes.set(key, Date.now());
    res.json({ success: true, ...await groupService.sync(req.groupScope.uid, instanceId) });
  }));
  router.get('/details', wrap(async (req, res) => {
    const { chat } = await conversation(req);
    const data = await groupService.details(req.groupScope.uid, chat.chat_id, req.query.refresh === '1');
    let canImportMembers = false;
    const db = await pool.getConnection();
    try { const ctx = await require('./phonebook-workspace').sessionContext(db, req.featureSession); canImportMembers = ctx.manage && ctx.uid === req.groupScope.uid; } catch (error) { if (error.status !== 403) throw error; } finally { db.release(); }
    res.json({ success: true, group: data.group, stale: data.stale, canImportMembers, automation: false, noLeadCapture: true });
  }));
  router.get('/messages', wrap(async (req, res) => {
    const { chat } = await conversation(req);
    const before = Math.max(0, Number(req.query.before) || 0);
    const media = req.query.media === '1';
    const rows = await query(`SELECT * FROM beta_conversation WHERE uid=? AND chat_id=? ${before ? 'AND id < ?' : ''} ${media ? "AND type IN ('image','video','audio','document')" : ''} ORDER BY id DESC LIMIT 100`, [req.groupScope.uid, chat.chat_id, ...(before ? [before] : [])]);
    if (!before && !media) await query('UPDATE beta_chats SET unread_count=0 WHERE uid=? AND chat_id=?', [req.groupScope.uid, chat.chat_id]);
    const visible = media ? rows.filter(row => !require('../../helper/maintenance/whatsappMediaRetention').expiredMedia(row)) : rows;
    res.json({ success: true, messages: visible.reverse().map(row => ({ ...row, msgContext: (() => { try { return JSON.parse(row.msgContext); } catch { return {}; } })(), context: (() => { try { return JSON.parse(row.context); } catch { return null; } })() })), more: rows.length === 100 });
  }));
  router.post('/send', wrap(async (req, res) => {
    const { chat, group } = await conversation(req);
    const text = String(req.body?.text || '').trim();
    if (!text || text.length > 4000) fail('INVALID_MESSAGE', 400);
    const content = { text };
    const mentioned = Array.isArray(req.body.mentions) ? req.body.mentions : [];
    if (mentioned.length > 30 || mentioned.some(jid => !group.participants.some(member => [member.jid, member.lid].includes(jid)))) fail('INVALID_MENTIONS', 400);
    if (mentioned.length) content.mentions = mentioned;
    let options = {};
    if (req.body.replyTo) {
      const [row] = await query('SELECT * FROM beta_conversation WHERE uid=? AND chat_id=? AND metaChatId=? LIMIT 1', [req.groupScope.uid, chat.chat_id, String(req.body.replyTo)]);
      if (!row) fail('QUOTED_MESSAGE_NOT_FOUND', 404);
      const payload = typeof row.msgContext === 'string' ? JSON.parse(row.msgContext) : row.msgContext;
      options.quoted = { key: { remoteJid: group.jid, id: row.metaChatId, fromMe: row.route === 'OUTGOING', participant: payload?.group?.participantJid }, message: { conversation: payload?.text?.body || payload?.[row.type]?.caption || `[${row.type}]` } };
    }
    // Recheck account/session immediately before the external send.
    await refreshReply(req, chat);
    const target = await groupService.sendTarget(req.groupScope.uid, chat.chat_id);
    const result = await target.session.sendMessage(target.jid, content, options);
    if (!result?.key?.id) fail('GROUP_SEND_FAILED', 502);
    const data = { type: 'text', metaChatId: result.key.id, msgContext: JSON.stringify({ type: 'text', text: { body: text, preview_url: false }, group: { jid: group.jid, participantName: 'You', mentions: mentioned } }),
      reaction: '', timestamp: Math.floor(Date.now() / 1000), senderName: 'You', senderMobile: target.session.user?.id || '', route: 'OUTGOING', origin: 'qr', status: 'sent', sentBy: 'human', star: 0, context: null };
    await require('./chatbot-conversation-store').persistConversationMessage({ uid: req.groupScope.uid, chatId: chat.chat_id, data, pool });
    await groupService.record({ uid: req.groupScope.uid, instanceId: group.instanceId, jid: group.jid, message: { ...data, msgContext: JSON.parse(data.msgContext) } });
    require('../../socket').sendToUid(req.groupScope.uid, { chatId: chat.chat_id }, 'request_update_chat_list');
    res.json({ success: true, id: result.key.id });
  }));
  router.post('/media', require('express-fileupload')({ limits: { fileSize: 16 * 1024 * 1024, files: 1, fields: 3 }, abortOnLimit: true, createParentPath: false }), wrap(async (req, res) => {
    const { chat, group } = await conversation(req);
    const file = req.files?.file, spec = require('./qr-group-media').inspect(file);
    const caption = String(req.body?.caption || '').slice(0, 1024);
    await refreshReply(req, chat);
    const target = await groupService.sendTarget(req.groupScope.uid, chat.chat_id);
    const crypto = require('node:crypto'), fs = require('node:fs/promises'), path = require('node:path');
    const filename = crypto.randomUUID() + '_qrgroup.' + spec.suffix;
    const directory = path.resolve(__dirname, '../../client/public/meta-media'), disk = path.join(directory, filename);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(disk, file.data, { flag: 'wx', mode: 0o644 });
    let result;
    try {
      result = await target.session.sendMessage(target.jid, { [spec.kind]: file.data, mimetype: spec.mime, ...(spec.kind === 'document' ? { fileName: spec.filename } : {}), ...(['image', 'video', 'document'].includes(spec.kind) ? { caption } : {}) });
      if (!result?.key?.id) fail('GROUP_SEND_FAILED', 502);
    } catch (error) { await fs.unlink(disk).catch(() => {}); throw error; }
    const context = { type: spec.kind, [spec.kind]: { link: new URL('/meta-media/' + filename, origin || 'https://7network.live').href, caption, filename: spec.filename }, group: { jid: group.jid, participantName: 'You' } };
    const data = { type: spec.kind, metaChatId: result.key.id, msgContext: JSON.stringify(context), reaction: '', timestamp: Math.floor(Date.now() / 1000), senderName: 'You', senderMobile: target.session.user?.id || '', route: 'OUTGOING', origin: 'qr', status: 'sent', sentBy: 'human', star: 0, context: null };
    await require('./chatbot-conversation-store').persistConversationMessage({ uid: req.groupScope.uid, chatId: chat.chat_id, data, pool });
    await groupService.record({ uid: req.groupScope.uid, instanceId: group.instanceId, jid: group.jid, message: { ...data, msgContext: context } });
    require('../../socket').sendToUid(req.groupScope.uid, { chatId: chat.chat_id }, 'request_update_chat_list');
    res.json({ success: true, id: result.key.id });
  }));
  router.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(error.status || (error.code === 'TEAM_INBOX_PERMISSION_DENIED' ? 403 : 503)).json({ success: false, code: error.code || 'QR_GROUP_UNAVAILABLE' }); });
  return router;
};
