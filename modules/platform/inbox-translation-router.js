'use strict';

const express = require('express');
const { decision } = require('./policy');

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const MAX_TEXT_LENGTH = 4000;
const MAX_REQUESTS_PER_MINUTE = 30;
const DEFAULT_AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
const requests = new Map();
let lastSweep = 0;

function createInboxTranslationRouter({
  authenticate,
  origin = process.env.SALEMAX_PLATFORM_ORIGIN,
  fetchImpl = global.fetch,
  endpoint = process.env.SALEMAX_TRANSLATION_URL,
  azureKey = process.env.SALEMAX_AZURE_TRANSLATOR_KEY,
  azureRegion = process.env.SALEMAX_AZURE_TRANSLATOR_REGION,
  azureEndpoint = process.env.SALEMAX_AZURE_TRANSLATOR_ENDPOINT || DEFAULT_AZURE_ENDPOINT,
} = {}) {
  const router = express.Router();
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  router.use(express.json({ limit: '12kb', strict: true }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST' || !require('./request-origin').matches(req, origin)) {
      return res.status(403).json({ success: false, code: 'ORIGIN_DENIED' });
    }
    next();
  });
  router.use(authenticate);

  router.post('/', wrap(async (req, res) => {
    const context = req.featureSession?.context;
    const access = decision(context, { capability: 'messaging.inbox', permission: 'conversations.read' });
    if (!access.allowed) return res.status(403).json({ success: false, code: access.code || 'PERMISSION_DENIED' });

    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ success: false, code: text?.length > MAX_TEXT_LENGTH ? 'TEXT_TOO_LONG' : 'INVALID_TEXT' });
    }
    if (typeof fetchImpl !== 'function') return res.status(503).json({ success: false, code: 'TRANSLATION_UNAVAILABLE' });

    const identity = `${context.tenant.id}:${context.membership.id}`;
    const now = Date.now();
    const recent = (requests.get(identity) || []).filter(timestamp => now - timestamp < 60_000);
    if (recent.length >= MAX_REQUESTS_PER_MINUTE) return res.status(429).json({ success: false, code: 'TRANSLATION_RATE_LIMITED' });
    recent.push(now);
    requests.set(identity, recent);
    if (now - lastSweep > 60_000) {
      lastSweep = now;
      for (const [key, values] of requests) {
        const live = values.filter(timestamp => now - timestamp < 60_000);
        if (live.length) requests.set(key, live); else requests.delete(key);
      }
    }

    const source = ARABIC.test(text) ? 'ar' : 'en';
    const target = source === 'ar' ? 'en' : 'ar';
    const azureCredential = typeof azureKey === 'string' && azureKey.trim();

    if (azureCredential) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const base = new URL(azureEndpoint || DEFAULT_AZURE_ENDPOINT);
        if (base.protocol !== 'https:' || base.username || base.password) throw new Error('INVALID_TRANSLATOR_ENDPOINT');
        const basePath = base.pathname.replace(/\/+$/, '');
        base.pathname = basePath.endsWith('/translate') ? basePath : `${basePath}/translate`;
        base.search = '';
        base.searchParams.set('api-version', '3.0');
        base.searchParams.set('from', source);
        base.searchParams.set('to', target);
        const headers = { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json', 'Ocp-Apim-Subscription-Key': azureCredential.trim() };
        if (typeof azureRegion === 'string' && azureRegion.trim()) headers['Ocp-Apim-Subscription-Region'] = azureRegion.trim();
        const response = await fetchImpl(base, {
          method: 'POST', headers, body: JSON.stringify([{ Text: text }]), signal: controller.signal,
        });
        if (response.ok) {
          const result = await response.json();
          const translated = result?.[0]?.translations?.[0]?.text;
          if (typeof translated === 'string' && translated.trim()) {
            return res.json({ success: true, data: { text: translated, targetLanguage: target, provider: 'azure' } });
          }
        }
        // F0 quota exhaustion, rate limits, credential/resource errors and provider outages all use the in-house fallback.
      } catch {
        // Keep provider credentials, chat text and upstream errors out of logs and client responses.
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!endpoint) return res.status(503).json({ success: false, code: 'TRANSLATION_UNAVAILABLE' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ q: text, source, target, format: 'text' }),
        signal: controller.signal,
      });
      if (!response.ok) return res.status(503).json({ success: false, code: 'TRANSLATION_UNAVAILABLE' });
      const result = await response.json();
      if (typeof result?.translatedText !== 'string' || !result.translatedText.trim()) {
        return res.status(503).json({ success: false, code: 'TRANSLATION_EMPTY' });
      }
      return res.json({ success: true, data: { text: result.translatedText, targetLanguage: target, provider: 'libretranslate' } });
    } catch {
      return res.status(503).json({ success: false, code: 'TRANSLATION_UNAVAILABLE' });
    } finally {
      clearTimeout(timeout);
    }
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.too.large' || error.type === 'entity.parse.failed' ? 400 : 503);
    const code = error.type === 'entity.too.large' ? 'BODY_TOO_LARGE' : error.type === 'entity.parse.failed' ? 'INVALID_JSON' : status === 503 ? 'TRANSLATION_UNAVAILABLE' : error.code || 'REQUEST_FAILED';
    res.status(status).json({ success: false, code });
  });
  return router;
}

module.exports = { createInboxTranslationRouter, MAX_TEXT_LENGTH, MAX_REQUESTS_PER_MINUTE, DEFAULT_AZURE_ENDPOINT };
