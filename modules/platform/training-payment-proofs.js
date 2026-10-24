'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const payments = require('./training-payments');
const objectStorage = require('./object-storage');

const fail = (code, status) => { throw Object.assign(new Error(code), { code, status }); };
const LIMIT = 5 * 1024 * 1024;

function signature(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: '.jpg' };
  if (Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: '.png' };
  if (Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', extension: '.webp' };
  return null;
}

function storageRoot(env = process.env) {
  const root = String(env.SALEMAX_PAYMENT_PROOF_ROOT || '').trim();
  if (!root || !path.isAbsolute(root)) fail('PAYMENT_PROOF_STORAGE_NOT_CONFIGURED', 503);
  return path.resolve(root);
}

function store(env = process.env) {
  const selected = objectStorage.driver(env, 'payment-proofs');
  return objectStorage.createStore({ namespace: 'payment-proofs', env, root: selected === 'local' ? storageRoot(env) : undefined });
}

async function upload(db, ctx, paymentId, file, { env = process.env, invoiceId = null } = {}) {
  payments.requireRole(ctx, 'payments.verify', ['owner', 'accountant', 'manager']);
  if (!/^[0-9a-f-]{36}$/i.test(paymentId || '')) fail('INVALID_PAYMENT_ID', 400);
  if (!file || file.truncated || !file.tempFilePath || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > LIMIT) fail('INVALID_PAYMENT_PROOF', 400);
  const bytes = await fs.readFile(file.tempFilePath);
  if (bytes.length !== file.size || bytes.length > LIMIT) fail('INVALID_PAYMENT_PROOF', 400);
  const detected = signature(bytes);
  if (!detected || file.mimetype !== detected.mime) fail('PAYMENT_PROOF_TYPE_NOT_ALLOWED', 415);

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const tenantId = ctx.tenant.id;
  const fileName = `${crypto.randomBytes(18).toString('hex')}${detected.extension}`;
  const storageKey = `${tenantId}/${paymentId}/${fileName}`;
  const objects = store(env);
  let stored = false;
  try {
    await objects.putBuffer(storageKey, bytes, { contentType: detected.mime, sha256 });
    stored = true;
    await db.beginTransaction();
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE', [tenantId]);
    const [[payment]] = await db.query('SELECT id,invoice_id,status,proof_sha256 FROM sx_training_payments WHERE tenant_id=? AND id=? FOR UPDATE', [tenantId, paymentId]);
    if (!payment || invoiceId && payment.invoice_id !== invoiceId) fail('PAYMENT_NOT_FOUND', 404);
    if (!['pending_verification', 'posted'].includes(payment.status)) fail('PAYMENT_NOT_PENDING', 409);
    if (payment.proof_sha256) {
      await db.commit();
      await objects.remove(storageKey);
      stored = false;
      if (payment.proof_sha256 === sha256) return { uploaded: true, repeated: true, sha256 };
      fail('PAYMENT_PROOF_ALREADY_UPLOADED', 409);
    }
    await db.query('UPDATE sx_training_payments SET proof_storage_key=?,proof_sha256=?,proof_mime_type=?,proof_bytes=?,proof_uploaded_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?', [storageKey, sha256, detected.mime, bytes.length, tenantId, paymentId]);
    const eventId = crypto.randomUUID();
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.payment-proof-uploaded','payment',?,?,?)`, [eventId, tenantId, ctx.identity.id, paymentId, JSON.stringify({ sha256, mimeType: detected.mime, bytes: bytes.length }), eventId]);
    await db.commit();
    return { uploaded: true, repeated: false, sha256, mimeType: detected.mime, bytes: bytes.length };
  } catch (error) {
    try { await db.rollback(); } catch {}
    if (stored) await objects.remove(storageKey).catch(() => {});
    throw error;
  }
}

async function get(db, ctx, paymentId, { env = process.env } = {}) {
  payments.requireRole(ctx, 'payments.verify', ['owner', 'accountant', 'manager']);
  if (!/^[0-9a-f-]{36}$/i.test(paymentId || '')) fail('INVALID_PAYMENT_ID', 400);
  const [[row]] = await db.query('SELECT proof_storage_key,proof_sha256,proof_mime_type,proof_bytes,proof_uploaded_at FROM sx_training_payments WHERE tenant_id=? AND id=?', [ctx.tenant.id, paymentId]);
  if (!row) fail('PAYMENT_NOT_FOUND', 404);
  if (!row.proof_storage_key) fail('PAYMENT_PROOF_NOT_FOUND', 404);
  const expectedPrefix = `${ctx.tenant.id}/${paymentId}/`;
  if (!row.proof_storage_key.startsWith(expectedPrefix) || row.proof_storage_key.includes('..')) fail('PAYMENT_PROOF_NOT_FOUND', 404);
  const objects = store(env);
  const metadata = await objects.head(row.proof_storage_key);
  if (metadata.contentLength !== Number(row.proof_bytes) || metadata.sha256 && metadata.sha256 !== String(row.proof_sha256).toLowerCase()) fail('PAYMENT_PROOF_INTEGRITY', 503);
  return { filePath: metadata.path || null, storageKey: row.proof_storage_key, driver: objects.driver, mimeType: row.proof_mime_type, bytes: Number(row.proof_bytes), sha256: row.proof_sha256, uploadedAt: row.proof_uploaded_at };
}

async function openRead(proof, { env = process.env } = {}) {
  if (!proof?.storageKey) fail('PAYMENT_PROOF_NOT_FOUND', 404);
  return store(env).openRead(proof.storageKey);
}

module.exports = { LIMIT, signature, storageRoot, store, upload, get, openRead };
