'use strict';

function previewAuditMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  return {
    provider: ['openai', 'deepseek', 'gemini'].includes(metrics.provider) ? metrics.provider : null,
    model: typeof metrics.model === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(metrics.model) ? metrics.model : null,
    inputTokens: Number.isSafeInteger(metrics.inputTokens) && metrics.inputTokens >= 0 ? metrics.inputTokens : null,
    outputTokens: Number.isSafeInteger(metrics.outputTokens) && metrics.outputTokens >= 0 ? metrics.outputTokens : null,
    cacheHit: metrics.cacheHit === true,
    latencyMs: Number.isFinite(metrics.latencyMs) && metrics.latencyMs >= 0 ? Math.round(metrics.latencyMs) : null,
  };
}

module.exports = { previewAuditMetrics };
