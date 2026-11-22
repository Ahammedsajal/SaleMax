'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadConversationControl(query) {
  const dbPromisePath = require.resolve('../database/dbpromise');
  const controlPath = require.resolve('../modules/platform/chatbot-conversation-control');
  const previousDbPromise = require.cache[dbPromisePath];
  const previousControl = require.cache[controlPath];
  require.cache[dbPromisePath] = {
    id: dbPromisePath, filename: dbPromisePath, loaded: true, exports: { query },
  };
  delete require.cache[controlPath];
  return {
    control: require('../modules/platform/chatbot-conversation-control'),
    restore() {
      delete require.cache[controlPath];
      delete require.cache[dbPromisePath];
      if (previousDbPromise) require.cache[dbPromisePath] = previousDbPromise;
      if (previousControl) require.cache[controlPath] = previousControl;
    },
  };
}

test('system staff-reply pauses have a 24-hour deadline and do not replace identity pauses', async () => {
  let statement = '';
  const loaded = loadConversationControl(async () => []);
  try {
    await loaded.control.pauseForStaffReply('owner', 'conversation', 'whatsapp_qr', 'qr-channel', async (sql, values) => {
      statement = sql;
      assert.equal(values[1], 'whatsapp_qr');
      assert.equal(values[2], 'qr-channel');
      assert.equal(values[3], 'conversation');
      assert.equal(values[5], 'owner');
      return [{ affectedRows: 1 }];
    });
    assert.match(statement, /TIMESTAMPADD\(HOUR,24,UTC_TIMESTAMP\(3\)\)/);
    assert.match(statement, /mode=IF\(updated_by_kind='identity',mode,'paused'\)/);
    assert.match(statement, /pause_until=IF\(updated_by_kind='identity',pause_until,VALUES\(pause_until\)\)/);
    assert.match(statement, /reason=IF\(updated_by_kind='identity',reason,'staff-replied'\)/);
  } finally { loaded.restore(); }
});

test('legacy system staff-reply pauses derive a 24-hour expiry from updated_at', async () => {
  let statement = '';
  const loaded = loadConversationControl(async sql => {
    statement = sql;
    return [{ mode: 'paused', pauseUntil: '2026-11-21 12:00:00.000', reason: 'staff-replied', updatedByKind: 'system' }];
  });
  try {
    const pause = await loaded.control.readPause('owner', 'conversation', 'whatsapp_qr', 'qr-channel');
    assert.equal(pause.reason, 'staff-replied');
    assert.match(statement, /c.reason='staff-replied' AND c.updated_by_kind='system'/);
    assert.match(statement, /COALESCE\(c.pause_until,TIMESTAMPADD\(HOUR,24,c.updated_at\)\)/);
  } finally { loaded.restore(); }
});

test('inbox bot-control reports the same effective expiry for legacy staff-reply pauses', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../modules/platform/chatbot-router'), 'utf8');
  assert.match(source, /c\.reason='staff-replied' AND c\.updated_by_kind='system'/);
  assert.match(source, /COALESCE\(c\.pause_until,TIMESTAMPADD\(HOUR,24,c\.updated_at\)\)/);
});

test('a persisted phone send pauses the matching QR chat even without a control row', async () => {
  const now = Math.floor(Date.now() / 1000);
  const loaded = loadConversationControl(async sql => sql.includes('FROM beta_conversation')
    ? [{ sentAtSeconds: now }] : []);
  try {
    const pause = await loaded.control.readPause('owner', 'conversation', 'whatsapp_qr', 'qr-channel');
    assert.equal(pause.reason, 'staff-replied');
    assert.equal(pause.derivedFromQrOutbound, true);
  } finally { loaded.restore(); }
});
