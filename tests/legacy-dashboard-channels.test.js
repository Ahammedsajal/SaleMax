'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listActiveChatbots, countConnectedWhatsAppChannels } = require('../modules/platform/legacy-dashboard-channels');

test('dashboard includes native live WhatsApp bots and deduplicates the legacy list', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM beta_chatbot')) return [{ title: 'Legacy bot', flow_id: 'flow-1' }, { title: 'Shared bot', flow_id: 'flow-2' }];
    return [{ title: 'Shared bot', flow_id: null }, { title: 'Recruitment bot', flow_id: null }];
  };
  const rows = await listActiveChatbots(query, 'owner-uid', { includePlatformProfiles: true });
  assert.deepEqual(rows, [
    { title: 'Shared bot', flow_id: null },
    { title: 'Recruitment bot', flow_id: null },
    { title: 'Legacy bot', flow_id: 'flow-1' },
  ]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /BINARY p\.status=BINARY 'live'/);
  assert.match(calls[1].sql, /BINARY a\.channel_kind IN \(BINARY 'whatsapp_meta',BINARY 'whatsapp_qr'\)/);
  assert.deepEqual(calls[1].params, ['owner-uid']);
});

test('dashboard avoids platform tables when platform features are disabled', async () => {
  const calls = [];
  const query = async sql => { calls.push(sql); return [{ title: 'Legacy bot', flow_id: null }]; };
  assert.deepEqual(await listActiveChatbots(query, 'owner-uid'), [{ title: 'Legacy bot', flow_id: null }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /FROM beta_chatbot/);
});

test('dashboard counts active QR and connected Meta WhatsApp channels', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ count: sql.includes('FROM instance') ? '1' : '2' }];
  };
  assert.equal(await countConnectedWhatsAppChannels(query, 'owner-uid'), 3);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /COUNT\(DISTINCT uniqueId\).*FROM instance/s);
  assert.match(calls[0].sql, /BINARY status=BINARY 'ACTIVE'/);
  assert.match(calls[1].sql, /COUNT\(DISTINCT business_phone_number_id\).*FROM meta_api/s);
  assert.deepEqual(calls.map(call=>call.params), [['owner-uid'], ['owner-uid']]);
});
