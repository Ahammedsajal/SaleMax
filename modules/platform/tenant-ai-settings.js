'use strict';
const crypto = require('node:crypto');
const secrets = require('./chatbot-secrets');
const providers = require('./chatbot-provider');
const fail = code => { throw Object.assign(new Error(code), { code }); };

async function read(db, tenantId) {
  const [[row]] = await db.query(`SELECT provider,model,daily_token_limit AS dailyTokenLimit,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [tenantId]);
  return row ? { configured: true, ...row, revision: Number(row.revision), dailyTokenLimit: Number(row.dailyTokenLimit), maskedKey: '••••••••' }
    : { configured: false, revision: 0, supportedProviders: Object.keys(providers.PROVIDERS) };
}

async function save(db, ctx, input) {
  const { provider, model, apiKey, expectedRevision } = input || {};
  if (!providers.PROVIDERS[provider] || typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_PROVIDER_CONFIG');
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 2048)) fail('INVALID_PROVIDER_KEY');
  const dailyTokenLimit = input.dailyTokenLimit ?? 50000;
  if (!Number.isSafeInteger(dailyTokenLimit) || dailyTokenLimit < 1000 || dailyTokenLimit > 1000000) fail('INVALID_DAILY_TOKEN_LIMIT');
  const encrypted = apiKey === undefined ? null : secrets.encrypt(apiKey);
  await db.beginTransaction();
  try {
    const [[row]] = await db.query(`SELECT provider,revision,key_ciphertext,key_iv,key_auth_tag FROM sx_chatbot_provider_configs WHERE tenant_id=? FOR UPDATE`, [ctx.tenant.id]);
    const revision = Number(row?.revision || 0);
    if (revision !== expectedRevision) fail('STALE_REVISION');
    const [[liveBot]] = await db.query(`SELECT id FROM sx_chatbot_profiles WHERE tenant_id=? AND status='live'
      AND (engine='ai' OR (engine='hybrid' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(config,'$.aiFallback')),'true')<>'false')) LIMIT 1`, [ctx.tenant.id]);
    if (liveBot) fail('LIVE_BOT_MUST_BE_PAUSED');
    if (!row && !encrypted) fail('PROVIDER_KEY_REQUIRED');
    if (row && row.provider !== provider && !encrypted) fail('PROVIDER_KEY_REQUIRED');
    const nextRevision = revision + 1;
    if (row) await db.query(`UPDATE sx_chatbot_provider_configs SET provider=?,model=?,key_ciphertext=?,key_iv=?,key_auth_tag=?,daily_token_limit=?,revision=?,updated_by_identity_id=? WHERE tenant_id=?`,
      [provider, model, encrypted?.ciphertext ?? row.key_ciphertext, encrypted?.iv ?? row.key_iv, encrypted?.authTag ?? row.key_auth_tag, dailyTokenLimit, nextRevision, ctx.identity.id, ctx.tenant.id]);
    else await db.query(`INSERT INTO sx_chatbot_provider_configs(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit,revision,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,1,?)`,
      [ctx.tenant.id, provider, model, encrypted.ciphertext, encrypted.iv, encrypted.authTag, dailyTokenLimit, ctx.identity.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','tenant.ai-settings.updated','tenant-ai-settings',?,?,?)`,
      [crypto.randomUUID(), ctx.tenant.id, ctx.identity.id, ctx.tenant.id, JSON.stringify({ provider, model, dailyTokenLimit, keyRotated: !!encrypted, revision: nextRevision }), crypto.randomUUID()]);
    await db.commit();
    return { configured: true, provider, model, dailyTokenLimit, revision: nextRevision, maskedKey: '••••••••' };
  } catch (error) { await db.rollback(); throw error; }
}

async function forRuntime(db, tenantId) {
  const [[row]] = await db.query(`SELECT provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit
    FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [tenantId]);
  if (!row) return null;
  return { ...row, apiKey: secrets.decrypt(row) };
}

function qatarDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function reserveTokens(pool, tenantId, dailyTokenLimit, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(Number(dailyTokenLimit))) fail('INVALID_TOKEN_RESERVATION');
  const usageDate = qatarDate(), db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT IGNORE INTO sx_chatbot_usage_daily(tenant_id,usage_date) VALUES (?,?)`, [tenantId, usageDate]);
    const [[row]] = await db.query(`SELECT consumed_tokens AS consumed,reserved_tokens AS reserved FROM sx_chatbot_usage_daily WHERE tenant_id=? AND usage_date=? FOR UPDATE`, [tenantId, usageDate]);
    if (Number(row.consumed) + Number(row.reserved) + amount > Number(dailyTokenLimit)) { await db.rollback(); return null; }
    await db.query(`UPDATE sx_chatbot_usage_daily SET reserved_tokens=reserved_tokens+? WHERE tenant_id=? AND usage_date=?`, [amount, tenantId, usageDate]);
    await db.commit(); return { usageDate, amount };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

async function settleTokens(pool, tenantId, reservation, used) {
  if (!reservation) return;
  const actual = Number.isSafeInteger(used) && used >= 0 ? Math.min(used, 12000) : reservation.amount;
  await pool.query(`UPDATE sx_chatbot_usage_daily SET reserved_tokens=GREATEST(0,reserved_tokens-?),consumed_tokens=consumed_tokens+? WHERE tenant_id=? AND usage_date=?`, [reservation.amount, actual, tenantId, reservation.usageDate]);
}

module.exports = { read, save, forRuntime, reserveTokens, settleTokens };
