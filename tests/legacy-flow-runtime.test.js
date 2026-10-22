'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('the legacy flow distributor keeps same-conversation state separate by chatbot profile', async () => {
  const dbPath = require.resolve('../database/dbpromise');
  const runtimePath = require.resolve('../functions/chatbot');
  const googlePath = require.resolve('googleapis');
  const previousDb = require.cache[dbPath];
  const previousRuntime = require.cache[runtimePath];
  const previousGoogle = require.cache[googlePath];
  const rows = [];
  const queries = [];
  const query = async (sql, args = []) => {
    queries.push({ sql, args });
    if (sql.startsWith('SELECT * FROM flow_data WHERE owner_key_hash = ? AND uid = ? AND uniqueId = ?')) {
      return rows.filter(row => row.uid === args[1] && row.uniqueId === args[2]);
    }
    if (sql.startsWith('INSERT INTO flow_data (uid, uniqueId, other)')) {
      const row = { id: rows.length + 1, uid: args[0], uniqueId: args[1], inputs: null, other: args[2] };
      rows.push(row);
      return { insertId: row.id };
    }
    if (sql.startsWith('SELECT * FROM flow WHERE flow_id = ?')) {
      return [{ flow_id: args[0], prevent_list: '[]', ai_list: '[]' }];
    }
    throw new Error(`Unexpected query in runtime test: ${sql}`);
  };

  delete require.cache[runtimePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query } };
  require.cache[googlePath] = { id: googlePath, filename: googlePath, loaded: true, exports: { google: {} } };
  try {
    const { destributeTaskFlow } = require('../functions/chatbot');
    const send = async () => {};
    const run = (profileId, nodeId) => destributeTaskFlow({
      uid: 'synthetic-owner',
      chatbotFromMysq: { id: profileId },
      toName: 'Synthetic Contact',
      senderNumber: '97450000001',
      sendMetaMsg: send,
      chatId: 'synthetic-chat',
      nodes: [],
      edges: [],
      incomingMsg: 'hello',
      k: { id: nodeId, type: 'TAKE_INPUT', data: { msgContent: { type: 'text', text: { body: 'Please reply' } } } },
      flowData: { flow_id: `flow-${profileId}` },
    });

    await run(71, 'profile-71-input');
    await run(72, 'profile-72-input');

    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].uniqueId, rows[1].uniqueId);
    assert.match(rows[0].uniqueId, /^profile:71:/);
    assert.match(rows[1].uniqueId, /^profile:72:/);
    assert.equal(JSON.parse(rows[0].other).id, 'profile-71-input');
    assert.equal(JSON.parse(rows[1].other).id, 'profile-72-input');
    assert.ok(queries.some(item => item.sql.includes('WHERE owner_key_hash = ? AND uid = ? AND uniqueId = ?')));
  } finally {
    delete require.cache[runtimePath];
    if (previousRuntime) require.cache[runtimePath] = previousRuntime;
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousGoogle) require.cache[googlePath] = previousGoogle;
    else delete require.cache[googlePath];
  }
});
