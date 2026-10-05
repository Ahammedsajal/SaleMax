'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const courses = require('./training-courses');

const MiB = 1024 * 1024;
const MAX_FILE_BYTES = 1024 * MiB;
const TENANT_QUOTA_BYTES = 2 * 1024 * MiB;
const MAX_COURSE_FILES = 12;
const MEDIA_ROOT = path.resolve(process.env.SALEMAX_COURSE_MEDIA_DIR || path.join(__dirname, '../../database/local-runtime/course-media'));

const TYPES = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'application/pdf': { kind: 'document', extension: 'pdf' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/webm': { kind: 'video', extension: 'webm' },
  'video/quicktime': { kind: 'video', extension: 'mov' }
};
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const uuid = () => crypto.randomUUID();

function safeId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) fail('INVALID_ID');
  return value;
}

async function ensureDirectories() {
  await fsp.mkdir(MEDIA_ROOT, { recursive: true, mode: 0o700 });
  const rootStat = await fsp.lstat(MEDIA_ROOT);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('COURSE_MEDIA_STORAGE_UNAVAILABLE', 503);
  const temporary = path.join(MEDIA_ROOT, '.tmp');
  await fsp.mkdir(temporary, { recursive: true, mode: 0o700 });
  const tempStat = await fsp.lstat(temporary);
  if (!tempStat.isDirectory() || tempStat.isSymbolicLink()) fail('COURSE_MEDIA_STORAGE_UNAVAILABLE', 503);
  const entries = await fsp.readdir(temporary, { withFileTypes: true });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const file = path.join(temporary, entry.name);
    try { const stat = await fsp.stat(file); if (stat.mtimeMs < cutoff) await fsp.rm(file, { force: true }); }
    catch (_) { /* A concurrent upload or already-removed temp file is harmless. */ }
  }));
}

function tempDirectory() { return path.join(MEDIA_ROOT, '.tmp'); }

function sniffHeader(buffer, mime) {
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'application/pdf') return buffer.toString('ascii', 0, 5) === '%PDF-';
  if (mime === 'video/mp4' || mime === 'video/quicktime') return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

async function inspectUpload(file) {
  if (!file || file.truncated) fail('COURSE_MEDIA_TOO_LARGE', 413);
  const type = TYPES[String(file.mimetype || '').toLowerCase()];
  if (!type) fail('COURSE_MEDIA_TYPE_NOT_ALLOWED', 415);
  if (!Number.isSafeInteger(file.size) || file.size < 8 || file.size > MAX_FILE_BYTES) fail('COURSE_MEDIA_TOO_LARGE', 413);
  const handle = await fsp.open(file.tempFilePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!sniffHeader(header.subarray(0, bytesRead), file.mimetype.toLowerCase())) fail('COURSE_MEDIA_SIGNATURE_INVALID', 415);
  } finally { await handle.close(); }
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file.tempFilePath)) hash.update(chunk);
  return { ...type, mime: file.mimetype.toLowerCase(), size: file.size, sha256: hash.digest('hex') };
}

function displayName(value) {
  const name = path.basename(String(value || 'course-file')).normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name.length > 240) fail('INVALID_COURSE_MEDIA_NAME');
  return name;
}

function filePath(tenantId, courseId, storageKey) {
  for (const value of [tenantId, courseId, storageKey]) if (!/^[0-9a-f-]{36}$/i.test(value)) fail('INVALID_ID');
  const result = path.resolve(MEDIA_ROOT, tenantId, courseId, storageKey);
  if (!result.startsWith(MEDIA_ROOT + path.sep)) fail('INVALID_COURSE_MEDIA_PATH');
  return result;
}

async function list(db, ctx, courseId) {
  courses.object(ctx, 'courses.read');
  safeId(courseId);
  const [[course]] = await db.query('SELECT id FROM sx_training_courses WHERE tenant_id=? AND id=?', [ctx.tenant.id, courseId]);
  if (!course) fail('COURSE_NOT_FOUND', 404);
  const [rows] = await db.query(`SELECT id,media_kind AS kind,mime_type AS mimeType,original_name AS originalName,file_size_bytes AS sizeBytes,created_at AS createdAt
    FROM sx_training_course_media WHERE tenant_id=? AND course_id=? AND deleted_at IS NULL ORDER BY created_at,id`, [ctx.tenant.id, courseId]);
  return rows.map(row => ({ ...row, sizeBytes: Number(row.sizeBytes), downloadPath: `/${encodeURIComponent(courseId)}/media/${encodeURIComponent(row.id)}/access` }));
}

async function attach(db, ctx, courseId, file) {
  courses.object(ctx, 'courses.manage');
  safeId(courseId);
  const info = await inspectUpload(file);
  const id = uuid();
  const name = displayName(file.name);
  const directory = path.join(MEDIA_ROOT, ctx.tenant.id, courseId);
  const target = filePath(ctx.tenant.id, courseId, id);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  let moved = false;
  try {
    await db.beginTransaction();
    const [[tenant]] = await db.query('SELECT id,status FROM sx_tenants WHERE id=? FOR UPDATE', [ctx.tenant.id]);
    if (!tenant || tenant.status !== 'active') fail('ACCOUNT_INACTIVE', 409);
    const [[course]] = await db.query('SELECT id,status FROM sx_training_courses WHERE tenant_id=? AND id=? FOR UPDATE', [ctx.tenant.id, courseId]);
    if (!course) fail('COURSE_NOT_FOUND', 404);
    if (course.status === 'retired') fail('COURSE_RETIRED', 409);
    const [[usage]] = await db.query(`SELECT COUNT(*) AS file_count,COALESCE(SUM(file_size_bytes),0) AS used_bytes FROM sx_training_course_media WHERE tenant_id=? AND deleted_at IS NULL`, [ctx.tenant.id]);
    const [[courseUsage]] = await db.query(`SELECT COUNT(*) AS file_count FROM sx_training_course_media WHERE tenant_id=? AND course_id=? AND deleted_at IS NULL`, [ctx.tenant.id, courseId]);
    if (Number(courseUsage.file_count) >= MAX_COURSE_FILES) fail('COURSE_MEDIA_LIMIT_REACHED', 409);
    if (Number(usage.used_bytes) + info.size > TENANT_QUOTA_BYTES) fail('COURSE_MEDIA_QUOTA_EXCEEDED', 409);
    await file.mv(target);
    moved = true;
    await db.query(`INSERT INTO sx_training_course_media(id,tenant_id,course_id,media_kind,mime_type,original_name,storage_key,file_size_bytes,sha256_hex,created_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, ctx.tenant.id, courseId, info.kind, info.mime, name, id, info.size, info.sha256, ctx.identity.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','training.course-media-uploaded','training-course-media',?,?,?)`, [uuid(), ctx.tenant.id, ctx.identity.id, id, JSON.stringify({ courseId, kind: info.kind, mimeType: info.mime, sizeBytes: info.size, sha256: info.sha256 }), uuid()]);
    await db.commit();
    return { id, kind: info.kind, mimeType: info.mime, originalName: name, sizeBytes: info.size };
  } catch (error) {
    try { await db.rollback(); } catch (_) {}
    if (moved) await fsp.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

async function remove(db, ctx, courseId, mediaId) {
  courses.object(ctx, 'courses.manage');
  safeId(courseId); safeId(mediaId);
  await db.beginTransaction();
  try {
    const [[row]] = await db.query(`SELECT storage_key AS storageKey FROM sx_training_course_media
      WHERE tenant_id=? AND course_id=? AND id=? AND deleted_at IS NULL FOR UPDATE`, [ctx.tenant.id, courseId, mediaId]);
    if (!row) fail('COURSE_MEDIA_NOT_FOUND', 404);
    await db.query('UPDATE sx_training_course_media SET deleted_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND course_id=? AND id=?', [ctx.tenant.id, courseId, mediaId]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','training.course-media-removed','training-course-media',?,?,?)`, [uuid(), ctx.tenant.id, ctx.identity.id, mediaId, JSON.stringify({ courseId }), uuid()]);
    await db.commit();
    await fsp.rm(filePath(ctx.tenant.id, courseId, row.storageKey), { force: true }).catch(() => {});
    return { id: mediaId, removed: true };
  } catch (error) {
    try { await db.rollback(); } catch (_) {}
    throw error;
  }
}

async function getFile(db, tenantId, courseId, mediaId) {
  safeId(tenantId); safeId(courseId); safeId(mediaId);
  const [[row]] = await db.query(`SELECT media_kind AS kind,mime_type AS mimeType,original_name AS originalName,storage_key AS storageKey,file_size_bytes AS sizeBytes
    FROM sx_training_course_media WHERE tenant_id=? AND course_id=? AND id=? AND deleted_at IS NULL`, [tenantId, courseId, mediaId]);
  if (!row) fail('COURSE_MEDIA_NOT_FOUND', 404);
  return { ...row, path: filePath(tenantId, courseId, row.storageKey), sizeBytes: Number(row.sizeBytes) };
}

function accessToken(ctx, courseId, mediaId) {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ aud: 'salemax-course-media', tenantId: ctx.tenant.id, courseId, mediaId }, process.env.JWTKEY, { expiresIn: 10800 });
}

function verifyAccessToken(token) {
  const jwt = require('jsonwebtoken');
  let payload;
  try { payload = jwt.verify(token, process.env.JWTKEY, { audience: 'salemax-course-media' }); }
  catch (_) { fail('COURSE_MEDIA_ACCESS_REQUIRED', 401); }
  safeId(payload.tenantId); safeId(payload.courseId); safeId(payload.mediaId);
  return payload;
}

module.exports = { MEDIA_ROOT, MAX_FILE_BYTES, TENANT_QUOTA_BYTES, MAX_COURSE_FILES, ensureDirectories, tempDirectory, list, attach, remove, getFile, accessToken, verifyAccessToken };
