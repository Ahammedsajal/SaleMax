const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('../client/public/training-form-request');

test('retries one network failure with the same idempotent submission request', async () => {
  const calls = [];
  let retries = 0;
  const options = { method: 'POST', body: JSON.stringify({ submissionToken: 'same-token' }) };
  const response = await request.post(async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) throw new TypeError('Network unavailable');
    return { status: 200, body: { success: true } };
  }, '/submit', options, { retrySafe: true, delayMs: 0, onRetry: () => retries++ });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].init, options);
  assert.equal(calls[1].init, options);
  assert.equal(retries, 1);
});

test('retries one transient gateway response but does not retry application errors', async () => {
  for (const status of [502, 503, 504]) {
    let calls = 0;
    const response = await request.post(async () => (++calls === 1 ? { status } : { status: 201 }), '/submit', {}, { retrySafe: true, delayMs: 0 });
    assert.equal(response.status, 201);
    assert.equal(calls, 2);
  }

  let calls = 0;
  const response = await request.post(async () => { calls++; return { status: 429 }; }, '/submit', {}, { retrySafe: true, delayMs: 0 });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});

test('does not automatically retry when CAPTCHA is enabled or after a second network failure', async () => {
  let captchaCalls = 0;
  await assert.rejects(() => request.post(async () => { captchaCalls++; throw new TypeError('Network unavailable'); }, '/submit', {}, { retrySafe: false, delayMs: 0 }), TypeError);
  assert.equal(captchaCalls, 1);

  let networkCalls = 0;
  await assert.rejects(() => request.post(async () => { networkCalls++; throw new TypeError('Network unavailable'); }, '/submit', {}, { retrySafe: true, delayMs: 0 }), TypeError);
  assert.equal(networkCalls, 2);
});
