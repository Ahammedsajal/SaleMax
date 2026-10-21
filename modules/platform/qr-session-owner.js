'use strict';

async function resolveQrSessionOwner(query, uniqueId, requiredUid = null) {
  if (typeof query !== 'function' || typeof uniqueId !== 'string' || !uniqueId.trim()) return null;
  const rows = await query(
    'SELECT id, uid, uniqueId, number FROM instance WHERE uniqueId = ? LIMIT 2',
    [uniqueId],
  );
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (row?.id == null || !row?.uid || (requiredUid !== null && String(row.uid) !== String(requiredUid))) return null;
  return { instanceId: row.id, uid: String(row.uid), uniqueId: String(row.uniqueId), number: row.number || null };
}

module.exports = { resolveQrSessionOwner };
