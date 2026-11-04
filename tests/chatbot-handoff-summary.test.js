'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const summary = require('../modules/platform/chatbot-handoff-summary');
const aiSettings = require('../modules/platform/tenant-ai-settings');
const provider = require('../modules/platform/chatbot-provider');

test('fallback handoff summary is concise and uses only captured course and enquiry facts', () => {
  assert.equal(summary.fallback({ courseDetails: [{ nameEn: 'Advanced Excel' }], latestEnquiry: 'Which certificate will I get?' }),
    'Asked about Advanced Excel. Latest question: Which certificate will I get?');
  assert.match(summary.fallback({}), /review the recent conversation/i);
});

test('AI handoff summary is bounded, redacted, token-metered, and stored once', async () => {
  const originals = { forRuntime: aiSettings.forRuntime, reserveTokens: aiSettings.reserveTokens, settleTokens: aiSettings.settleTokens, generate: provider.generate };
  const sql = [], generated = [];
  const claim = { summaryContext: JSON.stringify([{ role: 'user', text: 'My phone is +974 5555 1234; which certificate?' }]), courseDetails: '[]', latestEnquiry: 'Which certificate?' };
  const db = { query: async (statement) => { sql.push(statement); if (statement.startsWith('UPDATE')) return [{ affectedRows: 1 }]; return [[claim]]; }, release() {} };
  const pool = { getConnection: async () => db, query: async (statement) => { sql.push(statement); return [{ affectedRows: 1 }]; } };
  aiSettings.forRuntime = async () => ({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'synthetic-test-key', daily_token_limit: 50000 });
  aiSettings.reserveTokens = async (_pool, _tenant, _legacy, amount) => ({ amount, usageDate: '2026-11-02' });
  aiSettings.settleTokens = async (_pool, _tenant, reservation, used, details) => { generated.push({ reservation, used, details }); };
  provider.generate = async input => { generated.push({ input }); return { reply: 'Customer asks which certificate applies; staff should confirm the course record.', inputTokens: 120, outputTokens: 18 }; };
  try {
    const result = await summary.summarize(pool, 'tenant-id', 'claim-id');
    assert.equal(result.ai, true);
    assert.match(result.text, /staff should confirm/);
    assert.doesNotMatch(generated[0].input.user, /5555|1234/);
    assert.equal(generated[1].used, 138);
    assert.match(sql.at(-1), /summary_context=NULL/);
  } finally {
    aiSettings.forRuntime = originals.forRuntime; aiSettings.reserveTokens = originals.reserveTokens;
    aiSettings.settleTokens = originals.settleTokens; provider.generate = originals.generate;
  }
});
