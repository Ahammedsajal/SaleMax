'use strict';

function allowedOrigins(platformOrigin, additional = process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS) {
  const values = [platformOrigin, ...String(additional || '').split(',')].map(value => String(value || '').trim()).filter(Boolean);
  const origins = new Set();
  for (const value of values) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('AUTH_ORIGIN_INVALID'); }
    const local = process.env.LOCAL_ONLY_MODE === 'true' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (parsed.origin !== value || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) throw new Error('AUTH_ORIGIN_INVALID');
    origins.add(parsed.origin);
  }
  if (!origins.size) throw new Error('AUTH_ORIGIN_INVALID');
  return origins;
}

function matches(req, platformOrigin) {
  if (req.crmTenantDomain) return req.get('Origin') === `https://${req.crmTenantDomain.hostname}`;
  const incoming = req.get('Origin');
  if (!incoming) return false;
  try { return allowedOrigins(platformOrigin).has(incoming); } catch { return false; }
}

function matchesPlatformHost(req, platformOrigin) {
  try {
    const host = String(req.hostname || '').toLowerCase();
    return [...allowedOrigins(platformOrigin)].some(origin => new URL(origin).hostname === host);
  } catch { return false; }
}

module.exports = { allowedOrigins, matches, matchesPlatformHost };
