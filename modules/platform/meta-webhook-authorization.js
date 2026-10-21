'use strict';

class MetaWebhookAuthorizationError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.name = 'MetaWebhookAuthorizationError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new MetaWebhookAuthorizationError(code, status);
}

function getPhoneBindings(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const bindings = [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!['messages', 'calls'].includes(change?.field)) continue;
      const phoneId = String(change?.value?.metadata?.phone_number_id || '');
      const wabaId = String(entry?.id || '');
      if (!/^\d{5,30}$/.test(phoneId) || !/^\d{5,30}$/.test(wabaId)) {
        fail('META_WEBHOOK_PHONE_BINDING_INVALID');
      }
      bindings.push({ phoneId, wabaId });
    }
  }
  if (!bindings.length) fail('META_WEBHOOK_PHONE_BINDING_MISSING');
  return [...new Map(bindings.map(binding => [`${binding.wabaId}:${binding.phoneId}`, binding])).values()];
}

async function resolveMetaWebhookOwner({ body, query, expectedUid, embedded = false }) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  if (!embedded && (typeof expectedUid !== 'string' || !expectedUid)) fail('META_WEBHOOK_OWNER_MISMATCH');
  const bindings = getPhoneBindings(body);
  let ownerUid = null;
  for (const binding of bindings) {
    const sql = embedded
      ? "SELECT uid FROM meta_api WHERE JSON_UNQUOTE(JSON_EXTRACT(embed_data, '$.waba.id')) = ? AND business_phone_number_id = ? LIMIT 2"
      : 'SELECT uid FROM meta_api WHERE uid = ? AND business_phone_number_id = ? LIMIT 2';
    const params = embedded ? [binding.wabaId, binding.phoneId] : [expectedUid, binding.phoneId];
    const rows = await query(sql, params);
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.uid) fail('META_WEBHOOK_OWNER_MISMATCH');
    const currentUid = String(rows[0].uid);
    if (expectedUid && currentUid !== expectedUid) fail('META_WEBHOOK_OWNER_MISMATCH');
    if (ownerUid && ownerUid !== currentUid) fail('META_WEBHOOK_MULTIPLE_OWNERS');
    ownerUid = currentUid;
  }
  return ownerUid;
}

module.exports = { MetaWebhookAuthorizationError, getPhoneBindings, resolveMetaWebhookOwner };
