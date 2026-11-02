'use strict';
const crypto = require('node:crypto');
const secrets = require('./chatbot-secrets');
const SUPPORTED_PROVIDERS = Object.freeze(['openai', 'deepseek', 'gemini']);
const MONTHLY_SPEND_REMINDER_USD = 10;
const PRICE_USD_PER_MILLION = Object.freeze({
  openai: Object.freeze({ 'gpt-6-luna': [0.10, 0.50], 'gpt-6.1-sol': [2, 10], 'gpt-6-astra': [10, 50], '*': [10, 50] }),
  gemini: Object.freeze({ 'gemini-3.1-flash-lite': [0.25, 1.50], 'gemini-3.8-flash': [0.75, 4.50], 'gemini-3.5-flash': [1.50, 9], '*': [1.50, 9] }),
  deepseek: Object.freeze({ 'deepseek-flash': [0.30, 1.20], 'deepseek-v4-pro': [1.32, 3.96], '*': [1.32, 3.96] }),
});
const fail = code => { throw Object.assign(new Error(code), { code }); };

function estimatedCostUsd(provider, model, inputTokens, outputTokens) {
  const rates = PRICE_USD_PER_MILLION[provider]?.[model] || PRICE_USD_PER_MILLION[provider]?.['*'];
  if (!rates) return 0;
  return (Math.max(0, Number(inputTokens) || 0) * rates[0] + Math.max(0, Number(outputTokens) || 0) * rates[1]) / 1_000_000;
}

async function read(db, tenantId) {
  const [[row]] = await db.query(`SELECT provider,model,daily_token_limit AS dailyTokenLimit,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [tenantId]);
  return row ? { configured: true, ...row, revision: Number(row.revision), dailyTokenLimit: Number(row.dailyTokenLimit), monthlySpendReminderUsd: MONTHLY_SPEND_REMINDER_USD, maskedKey: '••••••••' }
    : { configured: false, revision: 0, monthlySpendReminderUsd: MONTHLY_SPEND_REMINDER_USD, supportedProviders: [...SUPPORTED_PROVIDERS] };
}

async function save(db, ctx, input) {
  const { provider, model, apiKey, expectedRevision } = input || {};
  if (!SUPPORTED_PROVIDERS.includes(provider) || typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_PROVIDER_CONFIG');
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 2048)) fail('INVALID_PROVIDER_KEY');
  const dailyTokenLimit = input.dailyTokenLimit ?? 50000;
  if (!Number.isSafeInteger(dailyTokenLimit) || dailyTokenLimit < 1000 || dailyTokenLimit > 1000000) fail('INVALID_DAILY_TOKEN_LIMIT');
  const encrypted = apiKey === undefined ? null : secrets.encrypt(apiKey);
  await db.beginTransaction();
  try {
    const [[row]] = await db.query(`SELECT provider,revision,key_ciphertext,key_iv,key_auth_tag,daily_token_limit FROM sx_chatbot_provider_configs WHERE tenant_id=? FOR UPDATE`, [ctx.tenant.id]);
    const revision = Number(row?.revision || 0);
    if (revision !== expectedRevision) fail('STALE_REVISION');
    const [[liveBot]] = await db.query(`SELECT id FROM sx_chatbot_profiles WHERE tenant_id=? AND status='live'
      AND (engine='ai' OR (engine='hybrid' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(config,'$.aiFallback')),'true')<>'false')) LIMIT 1`, [ctx.tenant.id]);
    if (liveBot) fail('LIVE_BOT_MUST_BE_PAUSED');
    if (!row && !encrypted) fail('PROVIDER_KEY_REQUIRED');
    if (row && row.provider !== provider && !encrypted) fail('PROVIDER_KEY_REQUIRED');
    const nextRevision = revision + 1;
    const savedDailyTokenLimit = input.dailyTokenLimit ?? Number(row?.daily_token_limit || 50000);
    if (row) await db.query(`UPDATE sx_chatbot_provider_configs SET provider=?,model=?,key_ciphertext=?,key_iv=?,key_auth_tag=?,daily_token_limit=?,revision=?,updated_by_identity_id=? WHERE tenant_id=?`,
      [provider, model, encrypted?.ciphertext ?? row.key_ciphertext, encrypted?.iv ?? row.key_iv, encrypted?.authTag ?? row.key_auth_tag, savedDailyTokenLimit, nextRevision, ctx.identity.id, ctx.tenant.id]);
    else await db.query(`INSERT INTO sx_chatbot_provider_configs(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit,revision,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,1,?)`,
      [ctx.tenant.id, provider, model, encrypted.ciphertext, encrypted.iv, encrypted.authTag, dailyTokenLimit, ctx.identity.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','tenant.ai-settings.updated','tenant-ai-settings',?,?,?)`,
      [crypto.randomUUID(), ctx.tenant.id, ctx.identity.id, ctx.tenant.id, JSON.stringify({ provider, model, monthlySpendReminderUsd: MONTHLY_SPEND_REMINDER_USD, keyRotated: !!encrypted, revision: nextRevision }), crypto.randomUUID()]);
    await db.commit();
    return { configured: true, provider, model, dailyTokenLimit: savedDailyTokenLimit, monthlySpendReminderUsd: MONTHLY_SPEND_REMINDER_USD, revision: nextRevision, maskedKey: '••••••••' };
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

async function reserveTokens(pool, tenantId, _legacyDailyTokenLimit, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1) fail('INVALID_TOKEN_RESERVATION');
  const usageDate = qatarDate(), db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT IGNORE INTO sx_chatbot_usage_daily(tenant_id,usage_date) VALUES (?,?)`, [tenantId, usageDate]);
    await db.query(`UPDATE sx_chatbot_usage_daily SET reserved_tokens=reserved_tokens+? WHERE tenant_id=? AND usage_date=?`, [amount, tenantId, usageDate]);
    await db.commit(); return { usageDate, amount };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

async function settleTokens(pool, tenantId, reservation, used, details = {}) {
  const reservationAmount = Number.isSafeInteger(reservation?.amount) ? reservation.amount : 0;
  const usageDate = reservation?.usageDate || qatarDate();
  const actual = Number.isSafeInteger(used) && used >= 0 ? Math.min(used, 12000) : reservationAmount;
  let inputTokens = Number.isSafeInteger(details.inputTokens) && details.inputTokens >= 0 ? details.inputTokens : null;
  let outputTokens = Number.isSafeInteger(details.outputTokens) && details.outputTokens >= 0 ? details.outputTokens : null;
  if (inputTokens === null && outputTokens === null) { inputTokens = 0; outputTokens = actual; }
  else { inputTokens ??= 0; outputTokens ??= 0; if (inputTokens + outputTokens < actual) outputTokens += actual - inputTokens - outputTokens; }
  const cost = estimatedCostUsd(details.provider, details.model, inputTokens, outputTokens);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT IGNORE INTO sx_chatbot_usage_daily(tenant_id,usage_date) VALUES (?,?)`, [tenantId, usageDate]);
    await db.query(`UPDATE sx_chatbot_usage_daily SET reserved_tokens=GREATEST(0,reserved_tokens-?),consumed_tokens=consumed_tokens+? WHERE tenant_id=? AND usage_date=?`, [reservationAmount, actual, tenantId, usageDate]);
    if (cost > 0) {
      const month = `${usageDate.slice(0, 7)}-01`;
      await db.query(`INSERT INTO sx_chatbot_usage_monthly(tenant_id,usage_month,input_tokens,output_tokens,estimated_usd)
        VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE input_tokens=input_tokens+VALUES(input_tokens),output_tokens=output_tokens+VALUES(output_tokens),estimated_usd=estimated_usd+VALUES(estimated_usd)`,
      [tenantId, month, inputTokens, outputTokens, cost.toFixed(8)]);
      const [[monthly]] = await db.query(`SELECT estimated_usd AS estimatedUsd,reminder_enqueued_at AS reminderEnqueuedAt FROM sx_chatbot_usage_monthly WHERE tenant_id=? AND usage_month=? FOR UPDATE`, [tenantId, month]);
      if (Number(monthly.estimatedUsd) >= MONTHLY_SPEND_REMINDER_USD && !monthly.reminderEnqueuedAt) {
        await db.query(`INSERT IGNORE INTO sx_business_notification_events(id,tenant_id,event_key,kind,source_type,source_id,payload_json)
          VALUES (?,?,?,'ai_usage_monthly','tenant',?,?)`,
        [crypto.randomUUID(), tenantId, `ai-usage:${month.slice(0, 7)}`, tenantId, JSON.stringify({ month: month.slice(0, 7), estimatedUsd: Number(monthly.estimatedUsd), thresholdUsd: MONTHLY_SPEND_REMINDER_USD })]);
        await db.query(`UPDATE sx_chatbot_usage_monthly SET reminder_enqueued_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND usage_month=? AND reminder_enqueued_at IS NULL`, [tenantId, month]);
      }
    }
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

module.exports = { read, save, forRuntime, reserveTokens, settleTokens, estimatedCostUsd, MONTHLY_SPEND_REMINDER_USD };
