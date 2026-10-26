'use strict';
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');

const GROUP_MS = 48 * 60 * 60 * 1000;
const DIRECT_MS = 28 * 24 * 60 * 60 * 1000;
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const PUBLIC_ROOT = path.resolve(__dirname, '../../client/public');
const LEGACY_ROOT = path.resolve(__dirname, '../../conversations/inbox');
const HOSTS = new Set(['7network.live', 'www.7network.live', 'crm.salemax.qa']);
try { HOSTS.add(new URL(process.env.FRONTENDURI).host); } catch {}
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const quote = name => { if (!/^[A-Za-z0-9_]+$/.test(name)) throw Error('INVALID_RETENTION_IDENTIFIER'); return '`' + name + '`'; };

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  if (number > 0 && Number.isFinite(number)) return number < 1e12 ? number * 1000 : number;
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : 0;
}

function localReference(value, hosts = HOSTS) {
  if (typeof value !== 'string') return null;
  try {
    const absolute = /^https?:\/\//i.test(value);
    if (!absolute && !/^\/(?:meta-media|media)\//.test(value)) return null;
    const url = new URL(value, 'https://7network.live');
    if (absolute && !hosts.has(url.host)) return null;
    const match = url.pathname.match(/^\/(meta-media|media)\/([^/]+)$/);
    if (!match) return null;
    const filename = decodeURIComponent(match[2]);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,240}$/.test(filename) || filename.includes('..')) return null;
    return { directory: match[1], filename, key: `${match[1]}/${filename}` };
  } catch { return null; }
}

function references(value, hosts = HOSTS, result = new Map(), depth = 0) {
  if (depth > 30 || value == null) return result;
  if (Array.isArray(value)) { for (const item of value) references(item, hosts, result, depth + 1); return result; }
  if (typeof value === 'object') { for (const item of Object.values(value)) references(item, hosts, result, depth + 1); return result; }
  if (typeof value !== 'string') return result;
  const decoded = parse(value);
  if (decoded && typeof decoded === 'object') return references(decoded, hosts, result, depth + 1);
  // Consume complete absolute URLs first so an external URL with a local-looking
  // path cannot be mistaken for a file on this server.
  const tokens = value.match(/https?:\/\/[^\s"'<>\\]+|(?<![A-Za-z0-9:/])\/(?:meta-media|media)\/[^\s"'<>\\]+/gi) || [];
  for (const token of tokens) { const ref = localReference(token, hosts); if (ref) result.set(ref.key, ref); }
  return result;
}

function isGroup(message) {
  const context = parse(message.msgContext) || {};
  return String(message.chat_id || message.chatId || '').startsWith('qrgroup_') || /@g\.us$/.test(context.group?.jid || '');
}

function expiredMedia(message, publicRoot = PUBLIC_ROOT) {
  const context = parse(message.msgContext) || {};
  const kind = String(message.type || context.type || '').toLowerCase();
  if (!MEDIA_TYPES.has(kind)) return false;
  const ref = localReference(context[kind]?.link);
  if (!ref || syncFs.existsSync(path.join(publicRoot, ref.directory, ref.filename))) return false;
  const at = Math.max(timestamp(message.timestamp), timestamp(message.createdAt));
  return at > 0 && at + (isGroup(message) ? GROUP_MS : DIRECT_MS) <= Date.now();
}

function createMediaRetention({ query, publicRoot = PUBLIC_ROOT, conversationRoot = LEGACY_ROOT, now = () => Date.now(), hosts = HOSTS, maxScanRows = 100000 } = {}) {
  if (typeof query !== 'function') throw Error('RETENTION_QUERY_REQUIRED');
  async function run({ dryRun = false, maxFiles = 500, maxBytes = 512 * 1024 * 1024 } = {}) {
    const started = now(), usage = new Map(), protectedFiles = new Set();
    const result = { success: true, dryRun, groupHours: 48, directDays: 28, scannedFiles: 0, protectedFiles: 0, eligible: { group: 0, direct: 0, orphan: 0, bytes: 0 }, deletedFiles: 0, deletedBytes: 0, changedFiles: 0, failedFiles: 0, deferredFiles: 0 };
    let scannedRows = 0;
    const countRows = count => { scannedRows += count; if (scannedRows > maxScanRows) throw Error('RETENTION_SCAN_LIMIT_NO_FILES_DELETED'); };
    const protect = value => { for (const key of references(value, hosts).keys()) protectedFiles.add(key); };
    const register = (message, fallbackTime = 0) => {
      const context = parse(message.msgContext) || {};
      const group = isGroup(message), origin = String(message.origin || '').toLowerCase();
      const whatsapp = group || ['qr', 'meta', 'whatsapp', 'whatsapp_web'].includes(origin) || String(message.chat_id || '').startsWith('meta_');
      if (!whatsapp) { protect(context); protect(message.context); return; }
      const window = group ? GROUP_MS : DIRECT_MS;
      const at = Math.max(timestamp(message.timestamp), timestamp(message.createdAt), fallbackTime);
      const expiry = at > 0 ? at + window : Infinity;
      const refs = references(message.context, hosts);
      if (MEDIA_TYPES.has(String(message.type || context.type || '').toLowerCase())) references(context, hosts, refs);
      else protect(context);
      for (const [key, ref] of refs) {
        const previous = usage.get(key);
        usage.set(key, { ...ref, expiry: Math.max(previous?.expiry || 0, expiry), window: Math.max(previous?.window || 0, window), group: previous ? previous.group && group : group });
      }
    };

    // Keyset paging keeps message text/history intact and bounds each DB read.
    let cursor = 0;
    while (true) {
      const rows = await query("SELECT id,chat_id,type,msgContext,context,origin,timestamp,createdAt FROM beta_conversation WHERE id>? AND (type IN ('image','video','audio','document','sticker') OR msgContext LIKE '%media%' OR context LIKE '%media%') ORDER BY id LIMIT 500", [cursor]);
      countRows(rows.length);
      for (const row of rows) register(row);
      if (rows.length < 500) break;
      cursor = Number(rows[rows.length - 1].id);
    }
    const schema = await query("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN ('char','varchar','text','mediumtext','longtext','json') ORDER BY TABLE_NAME,ORDINAL_POSITION");
    const tables = new Map();
    for (const column of schema) {
      if (column.TABLE_NAME === 'beta_conversation') continue;
      if (!tables.has(column.TABLE_NAME)) tables.set(column.TABLE_NAME, []);
      tables.get(column.TABLE_NAME).push(column.COLUMN_NAME);
    }
    for (const table of ['beta_chats', 'chats']) {
      if (!tables.has(table)) continue;
      const rows = await query(`SELECT chat_id,origin,last_message FROM ${quote(table)} WHERE last_message IS NOT NULL`);
      countRows(rows.length);
      for (const row of rows) { const message = parse(row.last_message); if (message) register({ ...message, chat_id: row.chat_id, origin: row.origin }); }
    }
    // Campaigns, templates, bots, catalogues, avatars, scheduled payloads and
    // future modules can reuse an Inbox URL. Discover their persisted references
    // rather than maintaining a fragile table allowlist. Only matching file
    // values leave SQL; credentials and unrelated fields are not selected.
    for (const [table, allColumns] of tables) {
      const columns = allColumns.filter(name => !(table === 'beta_chats' || table === 'chats') || name !== 'last_message');
      if (!columns.length) continue;
      const condition = name => /^(file_?name|storage_?path|file_?path)$/i.test(name)
        ? `${quote(name)} IS NOT NULL`
        : `${quote(name)} LIKE '%media%'`;
      const select = columns.map(name => `CASE WHEN ${condition(name)} THEN ${quote(name)} ELSE NULL END AS ${quote(name)}`).join(',');
      for (let offset = 0; ; offset += 500) {
        const rows = await query(`SELECT ${select} FROM ${quote(table)} WHERE ${columns.map(condition).join(' OR ')} LIMIT 500 OFFSET ?`, [offset]);
        countRows(rows.length);
        for (const row of rows) for (const [name, value] of Object.entries(row)) {
          protect(value);
          if (/^(file_?name|storage_?path|file_?path)$/i.test(name) && typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,240}$/.test(value)) {
            protectedFiles.add('media/' + value); protectedFiles.add('meta-media/' + value);
          }
          if (/^(storage_?path|file_?path)$/i.test(name) && typeof value === 'string') {
            const stored = value.match(/(?:^|\/)(meta-media|media)\/([A-Za-z0-9][A-Za-z0-9_.-]{0,240})$/);
            if (stored) protectedFiles.add(`${stored[1]}/${stored[2]}`);
          }
        }
        if (rows.length < 500) break;
      }
    }
    let legacyBytes = 0;
    async function scanLegacy(directory) {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await scanLegacy(file);
        else if (entry.isFile() && entry.name.endsWith('.json')) {
          const stat = await fs.lstat(file);
          legacyBytes += stat.size;
          if (legacyBytes > 50 * 1024 * 1024) throw Error('RETENTION_LEGACY_SCAN_LIMIT_NO_FILES_DELETED');
          const data = JSON.parse(await fs.readFile(file, 'utf8'));
          const messages = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : null;
          if (!messages) { protect(data); continue; }
          countRows(messages.length);
          for (const message of messages) register({ ...message, chat_id: message.chat_id || message.chatId || (file.includes('qrgroup_') ? 'qrgroup_legacy' : ''), origin: message.origin || 'qr' }, timestamp(message.timestamp) ? 0 : stat.mtimeMs);
        }
      }
    }
    await scanLegacy(conversationRoot);

    const candidates = [];
    for (const directory of ['meta-media', 'media']) {
      const root = path.join(publicRoot, directory);
      let entries;
      try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries) {
        if (!entry.isFile()) continue; // Never follow symlinks or descend into asset directories.
        if (!localReference(`/${directory}/${encodeURIComponent(entry.name)}`, hosts)) continue;
        result.scannedFiles++;
        if (result.scannedFiles > 100000) throw Error('RETENTION_FILE_SCAN_LIMIT_NO_FILES_DELETED');
        const key = `${directory}/${entry.name}`, file = path.join(root, entry.name), ref = usage.get(key);
        if (protectedFiles.has(key)) { result.protectedFiles++; continue; }
        if (!ref && directory === 'media') continue; // Unowned uploads may be shared business assets.
        const stat = await fs.lstat(file);
        const window = ref?.window || DIRECT_MS;
        if (!stat.isFile() || Math.max(ref?.expiry || 0, stat.mtimeMs + window) > started) continue;
        const kind = ref ? ref.group ? 'group' : 'direct' : 'orphan';
        result.eligible[kind]++; result.eligible.bytes += stat.size;
        candidates.push({ file, stat, kind, filename: entry.name });
      }
    }
    candidates.sort((a, b) => (a.kind === 'group' ? 0 : 1) - (b.kind === 'group' ? 0 : 1) || a.stat.mtimeMs - b.stat.mtimeMs);
    if (dryRun) return result;
    for (const candidate of candidates) {
      // An individual large WhatsApp document must not be deferred forever.
      if (result.deletedFiles >= maxFiles || (result.deletedFiles > 0 && result.deletedBytes + candidate.stat.size > maxBytes)) { result.deferredFiles++; continue; }
      // A new send can reuse an old URL during a sweep. Preserve any file newly
      // referenced after the scan began, and recheck its inode/mtime before unlink.
      const fresh = await query('SELECT id FROM beta_conversation WHERE createdAt>=? AND (LOCATE(?,msgContext)>0 OR LOCATE(?,context)>0) LIMIT 1', [new Date(started - 1000), candidate.filename, candidate.filename]);
      if (fresh.length) { result.changedFiles++; continue; }
      try {
        const current = await fs.lstat(candidate.file);
        if (!current.isFile() || current.ino !== candidate.stat.ino || current.size !== candidate.stat.size || current.mtimeMs !== candidate.stat.mtimeMs) { result.changedFiles++; continue; }
        await fs.unlink(candidate.file);
        result.deletedFiles++; result.deletedBytes += current.size;
      } catch (error) { if (error.code !== 'ENOENT') result.failedFiles++; }
    }
    return result;
  }
  return { run };
}

module.exports = { GROUP_MS, DIRECT_MS, localReference, references, isGroup, expiredMedia, createMediaRetention };
