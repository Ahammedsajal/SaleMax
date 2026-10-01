async function main() {
  const base = process.env.SALEMAX_SMOKE_URL || 'http://127.0.0.1:3010';
  const url = new URL(base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('LOCAL_SMOKE_ONLY');
  const assert = require('node:assert/strict');
  const results = [];
  for (const route of ['/healthz', '/api/web/get_web_public', '/api/theme/get-theme-config', '/']) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, route);
    if (route === '/') assert.ok((await response.text()).includes('SaleMaX'));
    else {
      const body = await response.json();
      if (route === '/healthz') { assert.equal(body.status, 'ok'); assert.equal(body.qr.activeConnections, 0); }
      else assert.ok(body.success || body.data || body.theme);
    }
    results.push({ route, status: response.status });
  }
  console.log(JSON.stringify({ results, externalWrites: false, customerDataTouched: false }));
}
main().catch(error => { console.error('Baseline smoke failed:', error.code || error.message); process.exitCode=1; });
