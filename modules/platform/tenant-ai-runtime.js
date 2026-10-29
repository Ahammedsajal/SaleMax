'use strict';

const tenantAiSettings = require('./tenant-ai-settings');

const fail = (code, status = 503) => { throw Object.assign(new Error(code), { code, status }); };

function estimateReservation(input, maxOutputTokens = 350) {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  const inputTokens = Math.ceil(Buffer.byteLength(text || '') / 3) + 96;
  const outputTokens = Math.min(1000, Math.max(64, Number.isSafeInteger(maxOutputTokens) ? maxOutputTokens : 350));
  return Math.min(10000, Math.max(128, inputTokens + outputTokens));
}

async function run({ pool, tenantId, input, maxOutputTokens = 350, execute }, dependencies = {}) {
  if (!pool || typeof execute !== 'function') fail('AI_RUNTIME_INVALID_REQUEST', 400);
  if (!tenantId) return { configured: false };
  const settingsService = dependencies.settingsService || tenantAiSettings;
  const settings = await settingsService.forRuntime(pool, tenantId);
  if (!settings) return { configured: false };

  const reservation = await settingsService.reserveTokens(
    pool,
    tenantId,
    Number(settings.daily_token_limit),
    estimateReservation(input, maxOutputTokens),
  );
  if (!reservation) fail('DAILY_TOKEN_LIMIT', 429);

  let used = null;
  try {
    const result = await execute({ provider: settings.provider, model: settings.model, apiKey: settings.apiKey });
    const usage = result?.usage;
    if (Number.isSafeInteger(usage?.inputTokens) && Number.isSafeInteger(usage?.outputTokens)) {
      used = Math.max(0, usage.inputTokens + usage.outputTokens);
    } else if (Number.isSafeInteger(result?.inputTokens) && Number.isSafeInteger(result?.outputTokens)) {
      used = Math.max(0, result.inputTokens + result.outputTokens);
    }
    return { configured: true, result };
  } catch (error) {
    if (Number.isSafeInteger(error?.tokensUsed) && error.tokensUsed >= 0) used = error.tokensUsed;
    throw error;
  } finally {
    await settingsService.settleTokens(pool, tenantId, reservation, used);
  }
}

module.exports = { estimateReservation, run };
