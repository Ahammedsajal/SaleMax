'use strict';
const crypto = require('node:crypto');
const secrets = require('./chatbot-secrets');
const catalog = require('./ai-provider-catalog');
const SUPPORTED_PROVIDERS = Object.freeze(catalog.PROVIDERS.map(provider => provider.id));
const MONTHLY_SPEND_REMINDER_USD = 10;
const PRICE_USD_PER_MILLION = Object.freeze({
  openai: Object.freeze({ 'gpt-6-luna': [0.10, 0.50], 'gpt-6.1-sol': [2, 10], 'gpt-6-astra': [10, 50], '*': [10, 50] }),
  gemini: Object.freeze({ 'gemini-3.1-flash-lite': [0.25, 1.50], 'gemini-3.8-flash': [0.75, 4.50], 'gemini-3.5-flash': [1.50, 9], '*': [1.50, 9] }),
  deepseek: Object.freeze({ 'deepseek-flash': [0.30, 1.20], 'deepseek-v4-pro': [1.32, 3.96], '*': [1.32, 3.96] }),
});
const fail = code => { throw Object.assign(new Error(code), { code }); };

function estimateUsage(provider, model, inputTokens, outputTokens, details = {}) {
  const rates = PRICE_USD_PER_MILLION[provider]?.[model] || PRICE_USD_PER_MILLION[provider]?.['*'];
  const input = Math.max(0, Number(inputTokens) || 0), output = Math.max(0, Number(outputTokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(details.cachedInputTokens) || 0));
  const written = Math.min(input - cached, Math.max(0, Number(details.cacheWriteTokens) || 0));
  // Verified 30-minute OpenAI cache rates. Unknown models keep ordinary estimates.
  const knownCacheRate = provider === 'openai' && Object.hasOwn(PRICE_USD_PER_MILLION.openai, model);
  const readMultiplier = model === 'gpt-6.1-sol' ? 0.05 : 0.1;
  const readSavings = rates && knownCacheRate ? cached * rates[0] * (1 - readMultiplier) / 1_000_000 : 0;
  const writePremium = rates && knownCacheRate ? written * rates[0] * 0.25 / 1_000_000 : 0;
  const ordinaryCost = rates ? (input * rates[0] + output * rates[1]) / 1_000_000 : 0;
  return { estimatedUsd: ordinaryCost - readSavings + writePremium, cachedInputTokens: cached, cacheWriteTokens: written, readSavingsUsd: readSavings, writePremiumUsd: writePremium };
}

function estimatedCostUsd(provider, model, inputTokens, outputTokens, details) { return estimateUsage(provider, model, inputTokens, outputTokens, details).estimatedUsd; }

function providerCatalog() {
  return catalog.PROVIDERS.map(provider => ({ ...provider, models: provider.models.map(id => ({ id,
    inputUsdPerMillion: PRICE_USD_PER_MILLION[provider.id][id][0], outputUsdPerMillion: PRICE_USD_PER_MILLION[provider.id][id][1],
    ...(provider.id === 'openai' ? { cachedInputUsdPerMillion: Number((PRICE_USD_PER_MILLION.openai[id][0] * (id === 'gpt-6.1-sol' ? 0.05 : 0.1)).toPrecision(8)), cacheWriteUsdPerMillion: PRICE_USD_PER_MILLION.openai[id][0] * 1.25 } : {}),
  })) }));
}

async function usage(db, tenantId) {
  const month = `${qatarDate().slice(0, 7)}-01`;
  const [[row]] = await db.query(`SELECT input_tokens AS inputTokens,output_tokens AS outputTokens,estimated_usd AS estimatedUsd,
    cached_input_tokens AS cachedInputTokens,cache_write_tokens AS cacheWriteTokens,
    cache_read_savings_usd AS readSavingsUsd,cache_write_premium_usd AS writePremiumUsd,
    provider_requests AS providerRequests,cache_read_requests AS cacheReadRequests
    FROM sx_chatbot_usage_monthly WHERE tenant_id=? AND usage_month=?`, [tenantId, month]);
  const fields = ['inputTokens','outputTokens','estimatedUsd','cachedInputTokens','cacheWriteTokens','readSavingsUsd','writePremiumUsd','providerRequests','cacheReadRequests'];
  return { month: month.slice(0, 7), timezone: 'Asia/Qatar', ...Object.fromEntries(fields.map(key => [key, Number(row?.[key] || 0)])), monthlySpendReminderUsd: MONTHLY_SPEND_REMINDER_USD, replyCap: false, cacheTrackingSince: '2026-11-03' };
}

async function read(db, tenantId) {
  const [[active]] = await db.query(`SELECT provider,model,daily_token_limit AS dailyTokenLimit,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [tenantId]);
  const [savedRows] = await db.query(`SELECT provider,model,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_profiles WHERE tenant_id=?`, [tenantId]);
  const saved = new Map((savedRows || []).map(row => [row.provider, row]));
  // Preserve visibility of an active legacy credential if a profile backfill is pending.
  if (active && !saved.has(active.provider)) saved.set(active.provider, {
    provider: active.provider, model: active.model, revision: active.revision, updatedAt: active.updatedAt,
  });
  const providers = providerCatalog().map(provider => {
    const profile = saved.get(provider.id);
    return { ...provider, configured: Boolean(profile), active: active?.provider === provider.id,
      savedModel: profile?.model || null, profileRevision: Number(profile?.revision || 0), updatedAt: profile?.updatedAt || null };
  });
  return {
    configured: Boolean(active), provider: active?.provider || null, model: active?.model || null,
    dailyTokenLimit: Number(active?.dailyTokenLimit ?? 50000), revision: Number(active?.revision || 0),
    maskedKey: active ? '••••••••' : null, supportedProviders: [...SUPPORTED_PROVIDERS], providers,
    // Provider changes are atomic for the next AI request and never depend on bot status.
    promptCaching: { mode: 'stable_prefix', ttl: '30m', explicitControlsSupported: catalog.supportsCacheControls(active?.provider, active?.model), usageTracked: true },
    monthlySpendReminderUsd: MONTHLY_SPEND_REMINDER_USD,
  };
}

function validRevision(value) { return Number.isSafeInteger(value) && value >= 0; }

function validateProviderModel(provider, model) {
  if (!SUPPORTED_PROVIDERS.includes(provider) || typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model)) fail('INVALID_PROVIDER_CONFIG');
}

function normalizedApiKey(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length < 16 || value.length > 2048) fail('INVALID_PROVIDER_KEY');
  return value;
}

function validateDailyTokenLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1000 || value > 1000000) fail('INVALID_DAILY_TOKEN_LIMIT');
  return value;
}

async function lockTenant(db, tenantId) {
  const [[tenant]] = await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE', [tenantId]);
  if (!tenant) fail('TENANT_CONTEXT_REQUIRED');
}

async function getActiveConfig(db, tenantId) {
  const [[row]] = await db.query(`SELECT provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit AS dailyTokenLimit,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_configs WHERE tenant_id=? FOR UPDATE`, [tenantId]);
  return row || null;
}

async function getProviderProfile(db, tenantId, provider) {
  const [[row]] = await db.query(`SELECT provider,model,key_ciphertext,key_iv,key_auth_tag,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_profiles WHERE tenant_id=? AND provider=? FOR UPDATE`, [tenantId, provider]);
  return row || null;
}

async function saveProviderProfile(db, ctx, current, input, active) {
  const { provider, model } = input;
  const apiKey = normalizedApiKey(input.apiKey);
  validateProviderModel(provider, model);
  const expectedProviderRevision = input.expectedProviderRevision;
  if (expectedProviderRevision !== undefined && !validRevision(expectedProviderRevision)) fail('INVALID_PROVIDER_REVISION');
  if (expectedProviderRevision !== undefined && Number(current?.revision || 0) !== expectedProviderRevision) fail('STALE_REVISION');
  const prior = current || (active?.provider === provider ? active : null);
  const encrypted = apiKey === undefined ? null : secrets.encrypt(apiKey);
  if (!prior && !encrypted) fail('PROVIDER_KEY_REQUIRED');
  const credential = encrypted ? { key_ciphertext: encrypted.ciphertext, key_iv: encrypted.iv, key_auth_tag: encrypted.authTag } : prior;
  const nextRevision = Number(prior?.revision || 0) + 1;
  const values = [model, credential.key_ciphertext, credential.key_iv, credential.key_auth_tag, nextRevision, ctx.identity.id];
  if (current) {
    await db.query(`UPDATE sx_chatbot_provider_profiles SET model=?,key_ciphertext=?,key_iv=?,key_auth_tag=?,revision=?,updated_by_identity_id=?,updated_at=CURRENT_TIMESTAMP(3)
      WHERE tenant_id=? AND provider=?`, [...values, ctx.tenant.id, provider]);
  } else {
    await db.query(`INSERT INTO sx_chatbot_provider_profiles(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,revision,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?)`, [ctx.tenant.id, provider, model, credential.key_ciphertext, credential.key_iv, credential.key_auth_tag, nextRevision, ctx.identity.id]);
  }
  return { provider, model, key_ciphertext: credential.key_ciphertext, key_iv: credential.key_iv, key_auth_tag: credential.key_auth_tag, revision: nextRevision, keyRotated: Boolean(encrypted) };
}

async function writeActiveConfig(db, ctx, active, profile, dailyTokenLimit) {
  const nextRevision = Number(active?.revision || 0) + 1;
  if (active) {
    await db.query(`UPDATE sx_chatbot_provider_configs SET provider=?,model=?,key_ciphertext=?,key_iv=?,key_auth_tag=?,daily_token_limit=?,revision=?,updated_by_identity_id=? WHERE tenant_id=?`,
      [profile.provider, profile.model, profile.key_ciphertext, profile.key_iv, profile.key_auth_tag, dailyTokenLimit, nextRevision, ctx.identity.id, ctx.tenant.id]);
  } else {
    await db.query(`INSERT INTO sx_chatbot_provider_configs(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit,revision,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?)`, [ctx.tenant.id, profile.provider, profile.model, profile.key_ciphertext, profile.key_iv, profile.key_auth_tag, dailyTokenLimit, nextRevision, ctx.identity.id]);
  }
  return nextRevision;
}

async function recordChange(db, ctx, { action, provider, model, revision, providerRevision, keyRotated, activeChanged, dailyTokenLimit }) {
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity',?,'tenant-ai-settings',?,?,?)`,
  [crypto.randomUUID(), ctx.tenant.id, ctx.identity.id, action, ctx.tenant.id,
    JSON.stringify({ provider, model, revision, providerRevision, keyRotated: Boolean(keyRotated), activeChanged: Boolean(activeChanged), ...(dailyTokenLimit === undefined ? {} : { dailyTokenLimit }) }),
    crypto.randomUUID()]);
}

async function save(db, ctx, input = {}) {
  const action = input.action || 'save-and-activate';
  if (!['save-provider','save-and-activate','activate-provider','update-limits'].includes(action)) fail('INVALID_PROVIDER_ACTION');
  const provider = input.provider;
  if (action === 'activate-provider') {
    if (!SUPPORTED_PROVIDERS.includes(provider)) fail('INVALID_PROVIDER_CONFIG');
  } else if (action !== 'update-limits') validateProviderModel(provider, input.model);
  const apiKey = normalizedApiKey(input.apiKey);
  if (action !== 'activate-provider' && action !== 'update-limits' && input.expectedProviderRevision !== undefined && !validRevision(input.expectedProviderRevision)) fail('INVALID_PROVIDER_REVISION');
  if (action === 'update-limits') validateDailyTokenLimit(input.dailyTokenLimit);
  if (action !== 'save-provider' && !validRevision(input.expectedRevision)) fail('INVALID_PROVIDER_REVISION');

  await db.beginTransaction();
  try {
    await lockTenant(db, ctx.tenant.id);
    const active = await getActiveConfig(db, ctx.tenant.id);
    if (action !== 'save-provider' && Number(active?.revision || 0) !== input.expectedRevision) fail('STALE_REVISION');
    if (action === 'save-provider' && active?.provider === provider && (!validRevision(input.expectedRevision) || Number(active.revision) !== input.expectedRevision)) fail('STALE_REVISION');

    if (action === 'update-limits') {
      if (!active) fail('AI_PROVIDER_NOT_CONFIGURED');
      const nextRevision = Number(active.revision) + 1;
      await db.query('UPDATE sx_chatbot_provider_configs SET daily_token_limit=?,revision=?,updated_by_identity_id=? WHERE tenant_id=?',
        [input.dailyTokenLimit, nextRevision, ctx.identity.id, ctx.tenant.id]);
      await recordChange(db, ctx, { action: 'tenant.ai-settings.limit.updated', provider: active.provider, model: active.model, revision: nextRevision, keyRotated: false, activeChanged: false, dailyTokenLimit: input.dailyTokenLimit });
      await db.commit();
      return read(db, ctx.tenant.id);
    }

    if (action === 'activate-provider') {
      const profile = await getProviderProfile(db, ctx.tenant.id, provider);
      if (!profile) fail('PROVIDER_NOT_CONFIGURED');
      if (input.expectedProviderRevision !== undefined && Number(profile.revision) !== input.expectedProviderRevision) fail('STALE_REVISION');
      const dailyTokenLimit = Number(active?.dailyTokenLimit ?? 50000);
      const nextRevision = await writeActiveConfig(db, ctx, active, profile, dailyTokenLimit);
      await recordChange(db, ctx, { action: 'tenant.ai-settings.provider.activated', provider, model: profile.model, revision: nextRevision, providerRevision: Number(profile.revision), keyRotated: false, activeChanged: active?.provider !== provider, dailyTokenLimit });
      const result = await read(db, ctx.tenant.id);
      await db.commit();
      return result;
    }

    const existing = await getProviderProfile(db, ctx.tenant.id, provider);
    const profile = await saveProviderProfile(db, ctx, existing, { ...input, apiKey }, active);
    let activeRevision = Number(active?.revision || 0);
    let dailyTokenLimit = Number(active?.dailyTokenLimit ?? 50000);
    let activeChanged = false;
    if (action === 'save-and-activate') {
      if (input.dailyTokenLimit !== undefined) dailyTokenLimit = validateDailyTokenLimit(input.dailyTokenLimit);
      activeRevision = await writeActiveConfig(db, ctx, active, profile, dailyTokenLimit);
      activeChanged = active?.provider !== provider;
    } else if (active?.provider === provider) {
      if (input.dailyTokenLimit !== undefined) dailyTokenLimit = validateDailyTokenLimit(input.dailyTokenLimit);
      activeRevision = await writeActiveConfig(db, ctx, active, profile, dailyTokenLimit);
    }
    await recordChange(db, ctx, { action: activeChanged ? 'tenant.ai-settings.provider.activated' : 'tenant.ai-settings.provider.saved',
      provider, model: profile.model, revision: activeRevision || profile.revision, providerRevision: profile.revision,
      keyRotated: profile.keyRotated, activeChanged: activeChanged || active?.provider === provider,
      dailyTokenLimit: (activeChanged || active?.provider === provider) ? dailyTokenLimit : undefined });
    const result = await read(db, ctx.tenant.id);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('STALE_REVISION');
    throw error;
  }
}

async function test(db, ctx, input = {}) {
  const { provider, model } = input;
  validateProviderModel(provider, model);
  let apiKey = normalizedApiKey(input.apiKey);
  if (apiKey === undefined) {
    const [[profile]] = await db.query(`SELECT key_ciphertext,key_iv,key_auth_tag FROM sx_chatbot_provider_profiles WHERE tenant_id=? AND provider=?`, [ctx.tenant.id, provider]);
    if (profile) apiKey = secrets.decrypt(profile);
    else {
      const [[active]] = await db.query(`SELECT provider,key_ciphertext,key_iv,key_auth_tag FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [ctx.tenant.id]);
      if (active?.provider === provider) apiKey = secrets.decrypt(active);
    }
  }
  if (!apiKey) fail('PROVIDER_KEY_REQUIRED');
  try {
    await require('./chatbot-provider').generate({ provider, model, apiKey, maxOutputTokens: 64, connectionTest: true,
      system: 'Return a small JSON object with can_answer true, confidence 1, and reply "Connection successful". Do not add any other text.',
      user: 'This is a provider connectivity test. Return the requested JSON only.' });
  } catch { fail('PROVIDER_CONNECTION_FAILED'); }
  return { connected: true, provider, model };
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
    await db.query(`INSERT INTO sx_chatbot_usage_daily(tenant_id,usage_date,reserved_tokens) VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE reserved_tokens=reserved_tokens+VALUES(reserved_tokens)`, [tenantId, usageDate, amount]);
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
  const estimate = estimateUsage(details.provider, details.model, inputTokens, outputTokens, details);
  const cost = estimate.estimatedUsd;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT INTO sx_chatbot_usage_daily(tenant_id,usage_date,consumed_tokens) VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE reserved_tokens=GREATEST(0,reserved_tokens-?),consumed_tokens=consumed_tokens+VALUES(consumed_tokens)`, [tenantId, usageDate, actual, reservationAmount]);
    if (cost > 0) {
      const month = `${usageDate.slice(0, 7)}-01`;
      await db.query(`INSERT INTO sx_chatbot_usage_monthly(tenant_id,usage_month,input_tokens,output_tokens,estimated_usd,cached_input_tokens,cache_write_tokens,cache_read_savings_usd,cache_write_premium_usd,provider_requests,cache_read_requests)
        VALUES (?,?,?,?,?,?,?,?,?,1,?) ON DUPLICATE KEY UPDATE input_tokens=input_tokens+VALUES(input_tokens),output_tokens=output_tokens+VALUES(output_tokens),estimated_usd=estimated_usd+VALUES(estimated_usd),
        cached_input_tokens=cached_input_tokens+VALUES(cached_input_tokens),cache_write_tokens=cache_write_tokens+VALUES(cache_write_tokens),cache_read_savings_usd=cache_read_savings_usd+VALUES(cache_read_savings_usd),cache_write_premium_usd=cache_write_premium_usd+VALUES(cache_write_premium_usd),provider_requests=provider_requests+1,cache_read_requests=cache_read_requests+VALUES(cache_read_requests)`,
      [tenantId, month, inputTokens, outputTokens, cost.toFixed(8), estimate.cachedInputTokens, estimate.cacheWriteTokens, estimate.readSavingsUsd.toFixed(8), estimate.writePremiumUsd.toFixed(8), estimate.cachedInputTokens > 0 ? 1 : 0]);
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

module.exports = { read, save, test, forRuntime, reserveTokens, settleTokens, estimatedCostUsd, estimateUsage, usage, providerCatalog, MONTHLY_SPEND_REMINDER_USD };
