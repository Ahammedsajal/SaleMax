'use strict';

const express = require('express');
const { decision } = require('./policy');

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const MAX_TEXT_LENGTH = 4000;
const MAX_REQUESTS_PER_MINUTE = 30;
const requests = new Map();
let lastSweep = 0;

function createInboxTranslationRouter({ authenticate, origin = process.env.SALEMAX_PLATFORM_ORIGIN, fetchImpl = global.fetch, endpoint = process.env.SALEMAX_TRANSLATION_URL } = {}) {
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
    if (!endpoint || typeof fetchImpl !== 'function') return res.status(503).json({ success: false, code: 'TRANSLATION_UNAVAILABLE' });

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
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
      return res.json({ success: true, data: { text: result.translatedText, targetLanguage: target } });
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

module.exports = { createInboxTranslationRouter, MAX_TEXT_LENGTH, MAX_REQUESTS_PER_MINUTE };
