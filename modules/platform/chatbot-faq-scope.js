'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = code => { throw Object.assign(new Error(code), { code }); };

function profileId(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_FAQ_SCOPE');
  return value;
}

async function assertProfileScope(db, context, value) {
  const id = profileId(value);
  if (!id) return null;
  const [[row]] = await db.query(`SELECT id FROM sx_chatbot_profiles
    WHERE tenant_id=? AND id=? AND category_key=? AND category_version=? LIMIT 1`,
  [context.tenant.id, id, context.category.key, context.category.version]);
  if (!row) fail('BOT_NOT_FOUND');
  return id;
}

async function listForEditor(db, tenantId, scopeId) {
  const [rows] = await db.query(`SELECT id,profile_id AS profileId,question_en AS questionEn,answer_en AS answerEn,
      question_ar AS questionAr,answer_ar AS answerAr,is_active AS active,position,revision,updated_at AS updatedAt
    FROM sx_chatbot_faqs WHERE tenant_id=? AND profile_id <=> ?
    ORDER BY is_active DESC,position,created_at,id`, [tenantId, scopeId]);
  return rows.map(item => ({ ...item, active: !!item.active, position: Number(item.position), revision: Number(item.revision), profileId: item.profileId || null }));
}

async function loadForBot(db, tenantId, botId) {
  const [rows] = await db.query(`SELECT question_en AS questionEn,answer_en AS answerEn,
      question_ar AS questionAr,answer_ar AS answerAr
    FROM sx_chatbot_faqs
    WHERE tenant_id=? AND is_active=1 AND (profile_id IS NULL OR profile_id=?)
    ORDER BY CASE WHEN profile_id=? THEN 0 ELSE 1 END,position,created_at,id LIMIT 120`,
  [tenantId, botId || null, botId || null]);
  return rows;
}

module.exports = { profileId, assertProfileScope, listForEditor, loadForBot };
