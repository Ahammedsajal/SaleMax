'use strict';
const crypto = require('node:crypto');
const secrets = require('./chatbot-secrets');
const providers = require('./chatbot-provider');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const DEFAULT_DAILY_TOKEN_LIMIT = 50000;
const PROVIDER_IDS = ['openai', 'gemini', 'deepseek'].filter(provider => providers.PROVIDERS[provider]);

function validRevision(value) { return Number.isSafeInteger(value) && value >= 0; }
function validateProviderModel(provider, model) {
  if (!providers.PROVIDERS[provider] || typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model)) fail('INVALID_PROVIDER_CONFIG');
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
function configSummary(active, savedRows) {
  const saved = new Map(savedRows.map(row => [row.provider, row]));
  // This fallback keeps a current credential visible if an installation has
  // the new code before its backfill has finished. It never exposes the key.
  if (active && !saved.has(active.provider)) saved.set(active.provider, {
    provider: active.provider, model: active.model, revision: active.revision, updatedAt: active.updatedAt,
  });
  return {
    configured: Boolean(active),
    provider: active?.provider || null,
    model: active?.model || null,
    dailyTokenLimit: Number(active?.dailyTokenLimit ?? DEFAULT_DAILY_TOKEN_LIMIT),
    revision: Number(active?.revision || 0),
    maskedKey: active ? '••••••••' : null,
    supportedProviders: PROVIDER_IDS,
    providers: PROVIDER_IDS.map(provider => {
      const row = saved.get(provider);
      return {
        provider,
        configured: Boolean(row),
        active: active?.provider === provider,
        model: row?.model || null,
        revision: Number(row?.revision || 0),
        updatedAt: row?.updatedAt || null,
      };
    }),
  };
}

async function read(db, tenantId) {
  const [[active]] = await db.query(`SELECT provider,model,daily_token_limit AS dailyTokenLimit,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [tenantId]);
  const [saved] = await db.query(`SELECT provider,model,revision,updated_at AS updatedAt
    FROM sx_chatbot_provider_profiles WHERE tenant_id=?`, [tenantId]);
  return configSummary(active || null, saved || []);
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

async function saveProviderProfile(db, ctx, current, input, { strictProfileRevision = true } = {}) {
  const provider = input.provider;
  const model = input.model;
  const apiKey = normalizedApiKey(input.apiKey);
  validateProviderModel(provider, model);
  if (strictProfileRevision && input.expectedProviderRevision !== undefined && !validRevision(input.expectedProviderRevision)) fail('INVALID_PROVIDER_REVISION');
  if (strictProfileRevision && input.expectedProviderRevision !== undefined && Number(current?.revision || 0) !== input.expectedProviderRevision) fail('STALE_REVISION');

  // The legacy active row is a safe source if an old install missed the
  // backfill. The migration normally creates this profile before app rollout.
  const prior = current || (input.active && input.active.provider === provider ? input.active : null);
  const encrypted = apiKey === undefined ? null : secrets.encrypt(apiKey);
  if (!prior && !encrypted) fail('PROVIDER_KEY_REQUIRED');
  const credential = encrypted || prior;
  const nextRevision = Number(prior?.revision || 0) + 1;
  const values = [model, credential.key_ciphertext, credential.key_iv, credential.key_auth_tag, nextRevision, ctx.identity.id];
  if (current) {
    await db.query(`UPDATE sx_chatbot_provider_profiles SET model=?,key_ciphertext=?,key_iv=?,key_auth_tag=?,revision=?,updated_by_identity_id=?,updated_at=CURRENT_TIMESTAMP(3)
      WHERE tenant_id=? AND provider=?`, [...values, ctx.tenant.id, provider]);
  } else {
    await db.query(`INSERT INTO sx_chatbot_provider_profiles(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,revision,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?)`, [ctx.tenant.id, provider, model, credential.key_ciphertext, credential.key_iv, credential.key_auth_tag, nextRevision, ctx.identity.id]);
  }
  return { provider, model, key_ciphertext: credential.key_ciphertext, key_iv: credential.key_iv, key_auth_tag: credential.key_auth_tag, revision: nextRevision };
}

async function writeActiveConfig(db, ctx, active, profile, dailyTokenLimit) {
  const nextRevision = Number(active?.revision || 0) + 1;
  if (active) {
    await db.query(`UPDATE sx_chatbot_provider_configs SET provider=?,model=?,key_ciphertext=?,key_iv=?,key_auth_tag=?,daily_token_limit=?,revision=?,updated_by_identity_id=? WHERE tenant_id=?`,
      [profile.provider, profile.model, profile.key_ciphertext, profile.key_iv, profile.key_auth_tag, dailyTokenLimit, nextRevision, ctx.identity.id, ctx.tenant.id]);
  } else {
    await db.query(`INSERT INTO sx_chatbot_provider_configs(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit,revision,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    [ctx.tenant.id, profile.provider, profile.model, profile.key_ciphertext, profile.key_iv, profile.key_auth_tag, dailyTokenLimit, nextRevision, ctx.identity.id]);
  }
  return nextRevision;
}

async function recordChange(db, ctx, { action, provider, model, revision, providerRevision, keyRotated, activeChanged, dailyTokenLimit }) {
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity',?,'tenant-ai-settings',?,?,?)`,
  [crypto.randomUUID(), ctx.tenant.id, ctx.identity.id, action, ctx.tenant.id, JSON.stringify({ provider, model, revision, ...(providerRevision === undefined ? {} : { providerRevision }), keyRotated: Boolean(keyRotated), activeChanged: Boolean(activeChanged), ...(dailyTokenLimit === undefined ? {} : { dailyTokenLimit }) }), crypto.randomUUID()]);
}

async function save(db, ctx, input = {}) {
  const legacyRequest = input.action === undefined;
  const action = input.action || 'save-and-activate';
  if (!['save-provider', 'save-and-activate', 'activate-provider', 'update-limits'].includes(action)) fail('INVALID_PROVIDER_ACTION');
  const provider = input.provider;
  if (action !== 'update-limits' && !providers.PROVIDERS[provider]) fail('INVALID_PROVIDER_CONFIG');
  if (!legacyRequest && action !== 'update-limits' && !validRevision(input.expectedProviderRevision)) fail('INVALID_PROVIDER_REVISION');
  const apiKey = normalizedApiKey(input.apiKey);
  if (action === 'save-provider' || action === 'save-and-activate') validateProviderModel(provider, input.model);
  if (action === 'update-limits') validateDailyTokenLimit(input.dailyTokenLimit);
  if (action !== 'save-provider' && !validRevision(input.expectedRevision)) fail('INVALID_PROVIDER_REVISION');

  await db.beginTransaction();
  try {
    // A tenant row serializes first-time profile creation, provider switches,
    // and active-config updates even when no active provider exists yet.
    await lockTenant(db, ctx.tenant.id);
    const active = await getActiveConfig(db, ctx.tenant.id);
    if (action !== 'save-provider' && Number(active?.revision || 0) !== input.expectedRevision) fail('STALE_REVISION');
    if (action === 'save-provider' && active?.provider === provider && !validRevision(input.expectedRevision)) fail('INVALID_PROVIDER_REVISION');

    if (action === 'update-limits') {
      if (!active) fail('AI_PROVIDER_NOT_CONFIGURED');
      const nextRevision = Number(active.revision) + 1;
      await db.query('UPDATE sx_chatbot_provider_configs SET daily_token_limit=?,revision=?,updated_by_identity_id=? WHERE tenant_id=?',
        [input.dailyTokenLimit, nextRevision, ctx.identity.id, ctx.tenant.id]);
      await recordChange(db, ctx, { action: 'tenant.ai-settings.limit.updated', provider: active.provider, model: active.model, revision: nextRevision, keyRotated: false, activeChanged: false, dailyTokenLimit: input.dailyTokenLimit });
      const result = await read(db, ctx.tenant.id);
      await db.commit();
      return result;
    }

    if (action === 'activate-provider') {
      if (input.expectedProviderRevision !== undefined && !validRevision(input.expectedProviderRevision)) fail('INVALID_PROVIDER_REVISION');
      const profile = await getProviderProfile(db, ctx.tenant.id, provider);
      if (!profile) fail('PROVIDER_NOT_CONFIGURED');
      if (input.expectedProviderRevision !== undefined && Number(profile.revision) !== input.expectedProviderRevision) fail('STALE_REVISION');
      const nextRevision = await writeActiveConfig(db, ctx, active, profile, Number(active?.dailyTokenLimit ?? DEFAULT_DAILY_TOKEN_LIMIT));
      await recordChange(db, ctx, { action: 'tenant.ai-settings.provider.activated', provider, model: profile.model, revision: nextRevision, providerRevision: Number(profile.revision), keyRotated: false, activeChanged: active?.provider !== provider, dailyTokenLimit: Number(active?.dailyTokenLimit ?? DEFAULT_DAILY_TOKEN_LIMIT) });
      const result = await read(db, ctx.tenant.id);
      await db.commit();
      return result;
    }

    const existing = await getProviderProfile(db, ctx.tenant.id, provider);
    const profile = await saveProviderProfile(db, ctx, existing, { ...input, apiKey, active }, { strictProfileRevision: action === 'save-provider' || input.expectedProviderRevision !== undefined });
    const activeChanged = action === 'save-and-activate';
    let activeRevision = Number(active?.revision || 0);
    let dailyTokenLimit = Number(active?.dailyTokenLimit ?? DEFAULT_DAILY_TOKEN_LIMIT);
    if (activeChanged) {
      if (input.dailyTokenLimit !== undefined) dailyTokenLimit = validateDailyTokenLimit(input.dailyTokenLimit);
      activeRevision = await writeActiveConfig(db, ctx, active, profile, dailyTokenLimit);
    } else if (active?.provider === provider) {
      if (input.expectedRevision !== undefined && Number(active.revision) !== input.expectedRevision) fail('STALE_REVISION');
      if (input.dailyTokenLimit !== undefined) dailyTokenLimit = validateDailyTokenLimit(input.dailyTokenLimit);
      activeRevision = await writeActiveConfig(db, ctx, active, profile, dailyTokenLimit);
    }
    await recordChange(db, ctx, {
      action: activeChanged ? 'tenant.ai-settings.provider.activated' : 'tenant.ai-settings.provider.saved',
      provider, model: profile.model, revision: activeRevision || profile.revision, providerRevision: profile.revision, keyRotated: Boolean(apiKey), activeChanged: activeChanged || active?.provider === provider,
      dailyTokenLimit: (activeChanged || active?.provider === provider) ? dailyTokenLimit : undefined,
    });
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
    await providers.generate({
      provider, model, apiKey, maxOutputTokens: 64, connectionTest: true,
      system: 'Return a small JSON object with can_answer true, confidence 1, and reply "Connection successful". Do not add any other text.',
      user: 'This is a provider connectivity test. Return the requested JSON only.',
    });
  } catch {
    fail('PROVIDER_CONNECTION_FAILED');
  }
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

module.exports = { read, save, test, forRuntime, reserveTokens, settleTokens };
