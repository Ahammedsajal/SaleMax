'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

async function main() {
  const database = `codex_inbox_scope_${crypto.randomBytes(8).toString('hex')}`;
  const socketPath = process.env.SALEMAX_TEST_MYSQL_SOCKET || '/tmp/mysql.sock';
  const admin = await mysql.createConnection({
    socketPath,
    user: process.env.SALEMAX_TEST_MYSQL_USER || 'root',
    ...(process.env.SALEMAX_TEST_MYSQL_PASSWORD
      ? { password: process.env.SALEMAX_TEST_MYSQL_PASSWORD }
      : {}),
  });
  let created = false;
  let db;
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    db = await mysql.createConnection({
      socketPath,
      user: process.env.SALEMAX_TEST_MYSQL_USER || 'root',
      ...(process.env.SALEMAX_TEST_MYSQL_PASSWORD
        ? { password: process.env.SALEMAX_TEST_MYSQL_PASSWORD }
        : {}),
      database,
    });

    await db.query(`
      CREATE TABLE beta_chats (
        id BIGINT PRIMARY KEY,
        uid VARCHAR(100) NOT NULL,
        chat_id VARCHAR(191) NOT NULL,
        unread_count INT NOT NULL DEFAULT 0,
        chat_label LONGTEXT,
        chat_note LONGTEXT,
        assigned_agent LONGTEXT,
        sender_name VARCHAR(191),
        sender_mobile VARCHAR(50),
        last_message LONGTEXT,
        UNIQUE KEY uq_beta_chat_tenant (uid, chat_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE beta_conversation (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        uid VARCHAR(100) NOT NULL,
        chat_id VARCHAR(191) NOT NULL,
        timestamp BIGINT NOT NULL DEFAULT 0,
        route VARCHAR(40),
        senderName VARCHAR(191),
        senderMobile VARCHAR(50),
        type VARCHAR(40),
        msgContext LONGTEXT,
        reaction TEXT,
        metaChatId VARCHAR(191),
        status VARCHAR(40),
        star TINYINT
      ) ENGINE=InnoDB
    `);
    await db.query('CREATE TABLE chat_tags (id BIGINT PRIMARY KEY, uid VARCHAR(100) NOT NULL, title VARCHAR(191)) ENGINE=InnoDB');
    await db.query('CREATE TABLE contact (id BIGINT PRIMARY KEY, uid VARCHAR(100) NOT NULL, mobile VARCHAR(50), name VARCHAR(191), var1 TEXT, var2 TEXT, var3 TEXT, var4 TEXT, var5 TEXT) ENGINE=InnoDB');
    await db.query('CREATE TABLE agents (id BIGINT PRIMARY KEY, uid VARCHAR(100), owner_uid VARCHAR(100), role VARCHAR(40)) ENGINE=InnoDB');
    await db.query('CREATE TABLE instance (id BIGINT PRIMARY KEY AUTO_INCREMENT, uid VARCHAR(100), uniqueId VARCHAR(100), title VARCHAR(191), number VARCHAR(50), status VARCHAR(40)) ENGINE=InnoDB');
    await db.query('CREATE TABLE user (id BIGINT AUTO_INCREMENT PRIMARY KEY, uid VARCHAR(100), timezone VARCHAR(80)) ENGINE=InnoDB');
    await db.query('CREATE TABLE phonebook (id BIGINT AUTO_INCREMENT PRIMARY KEY, uid VARCHAR(100), name VARCHAR(191)) ENGINE=InnoDB');
    await db.query('CREATE TABLE beta_chatbot (id BIGINT AUTO_INCREMENT PRIMARY KEY, uid VARCHAR(100), active TINYINT, source VARCHAR(80)) ENGINE=InnoDB');

    const ownerA = 'synthetic-owner-a';
    const ownerB = 'synthetic-owner-b';
    await db.query('INSERT INTO beta_chats (id,uid,chat_id,unread_count,chat_label,chat_note,assigned_agent,sender_name,sender_mobile,last_message) VALUES (?,?,?,?,?,?,?,?,?,?)', [
      101, ownerA, 'chat-a', 7, '[]', '[]', '[{"id":1}]', 'Customer A', '5550001', '{}',
    ]);
    await db.query('INSERT INTO beta_chats (id,uid,chat_id,unread_count,chat_label,chat_note,assigned_agent,sender_name,sender_mobile,last_message) VALUES (?,?,?,?,?,?,?,?,?,?)', [
      202, ownerB, 'chat-b', 9, '[{"id":4,"title":"Tenant B label"}]', '[{"id":"b-note","note":"private B note"}]', '[{"id":1}]', 'Customer B', '5550002', '{}',
    ]);
    await db.query('INSERT INTO beta_chats (id,uid,chat_id,unread_count,chat_label,chat_note,assigned_agent,sender_name,sender_mobile,last_message) VALUES (?,?,?,?,?,?,?,?,?,?)', [
      303, ownerA, 'chat-c', 3, '[]', '[]', '[{"id":2}]', 'Private Agent B Customer', '5550003', '{}',
    ]);
    await db.query('INSERT INTO agents (id,uid,owner_uid,role) VALUES (?,?,?,?)', [1, 'synthetic-agent-a', ownerA, 'agent']);
    await db.query('INSERT INTO chat_tags (id,uid,title) VALUES (10,?,?)', [ownerB, 'Tenant B label']);
    await db.query('INSERT INTO contact (id,uid,mobile,name) VALUES (20,?,?,?)', [ownerB, '5550002', 'Customer B']);
    await db.query('INSERT INTO user (uid,timezone) VALUES (?,?)', [ownerA, 'Asia/Qatar']);

    const sqlQuery = async (sql, params = []) => {
      const [rows] = await db.query(sql, params);
      return Array.isArray(rows) ? rows : [];
    };
    const modulePaths = [
      '../database/dbpromise',
      '../modules/platform/team-inbox-scope',
      '../modules/platform/delegated-account-session',
      '../helper/socket/function',
      '../functions/function.js',
      '../helper/pipeline/conversationAttendance',
      '../helper/addon/telegram/processTelegramInbox',
      '../helper/socket/index',
    ].map(specifier => require.resolve(specifier));
    const priorModules = new Map(modulePaths.map(filename => [filename, require.cache[filename]]));
    const stubs = new Map([
      [modulePaths[0], { query: sqlQuery }],
      [modulePaths[1], {
        ...require('../modules/platform/team-inbox-scope'),
        resolveInboxScope: async (_query, userData) => ({ canonical: false, uid: ownerA, assignedOnly: !!userData.isAgent, legacyAgent: !!userData.isAgent, agentId: userData.id, actorLegacyId: userData.id, actorUid: userData.uid }),
      }],
      [modulePaths[2], { assertDelegatedSession: async () => {} }],
      [modulePaths[3], { getCurrentTimestampInTimeZone: () => 1_800_000_000, mergeArraysWithPhonebook: chats => chats }],
      [modulePaths[4], { getCurrentTimestampInTimeZone: () => 1_800_000_000, readJSONFile: () => [] }],
      [modulePaths[5], {}],
      [modulePaths[6], {}],
    ]);
    try {
      for (const [filename, exports] of stubs) {
        require.cache[filename] = { id: filename, filename, loaded: true, exports };
      }
      delete require.cache[modulePaths[7]];
      const { processSocketEvent } = require('../helper/socket/index');
      const listeners = new Map();
      const emitted = [];
      const socket = {
        userData: { id: 1, uid: ownerA, role: 'user', isAgent: false, email: 'owner-a@example.test', name: 'Owner A', timezone: 'Asia/Qatar' },
        decodedToken: { uid: ownerA },
        on: (event, listener) => listeners.set(event, listener),
        emit: (event, payload) => emitted.push({ event, payload }),
      };
      processSocketEvent({ socket });
      const dispatch = (type, payload) => listeners.get('message')({ type, payload });

      await dispatch('load_conversation', { chat: { id: 202, chat_id: 'chat-b' }, filters: {} });
      await dispatch('set_chat_label', { chatIdRow: 202, labelData: { id: 5, title: 'Forged label' } });
      await dispatch('remove_chat_label', { chatId: 202, labelId: 4 });
      await dispatch('delete_chat_note', { chatRealId: 202, chatNoteId: 'b-note' });
      await dispatch('save_chat_note', { id: 202, chatNote: 'Forged note' });
      await dispatch('on_label_delete', { labelId: 10 });
      await dispatch('del_contact', { contactId: 20 });

      const [foreignChat] = await db.query('SELECT unread_count,chat_label,chat_note FROM beta_chats WHERE uid=? AND id=?', [ownerB, 202]);
      const [foreignTagCount] = await db.query('SELECT COUNT(*) AS count FROM chat_tags WHERE uid=? AND id=?', [ownerB, 10]);
      const [foreignContactCount] = await db.query('SELECT COUNT(*) AS count FROM contact WHERE uid=? AND id=?', [ownerB, 20]);
      assert.equal(foreignChat[0].unread_count, 9);
      assert.equal(foreignChat[0].chat_label, '[{"id":4,"title":"Tenant B label"}]');
      assert.equal(foreignChat[0].chat_note, '[{"id":"b-note","note":"private B note"}]');
      assert.equal(foreignTagCount[0].count, 1);
      assert.equal(foreignContactCount[0].count, 1);
      const foreignLoad = emitted.findLast(item => item.event === 'load_conversation');
      assert.ok(foreignLoad);
      assert.equal(foreignLoad.payload.conversation.length, 0);
      assert.equal(foreignLoad.payload.chatInfo?.sender_mobile, undefined);
      assert.equal(emitted.filter(item => item.event === 'load_conversation').length, 1);
      assert.equal(emitted.filter(item => item.event === 'error').length, 0);

      await dispatch('load_conversation', { chat: { id: 101, chat_id: 'chat-a' }, filters: {} });
      const [ownChat] = await db.query('SELECT unread_count FROM beta_chats WHERE uid=? AND id=?', [ownerA, 101]);
      assert.equal(ownChat[0].unread_count, 0, 'owner can still open and mark their own conversation read');
      assert.equal(emitted.filter(item => item.event === 'load_conversation').length, 2);
      assert.equal(emitted.filter(item => item.event === 'error').length, 0);

      const agentListeners = new Map(), agentEmitted = [];
      const agentSocket = {
        userData: { id: 1, uid: 'synthetic-agent-a', owner_uid: ownerA, role: 'agent', isAgent: true, is_active: 1, timezone: 'Asia/Qatar' },
        decodedToken: { uid: 'synthetic-agent-a' },
        on: (event, listener) => agentListeners.set(event, listener),
        emit: (event, payload) => agentEmitted.push({ event, payload }),
      };
      processSocketEvent({ socket: agentSocket });
      await agentListeners.get('message')({ type: 'get_chat_list', payload: {} });
      const agentList = agentEmitted.find(item => item.event === 'chat_list');
      assert.ok(agentList);
      assert.deepEqual(agentList.payload.chats.map(chat => chat.chat_id), ['chat-a'], 'legacy agent list remains owner-scoped when another business has the same stale assignment ID');
      const originalConsoleError=console.error;
      try {
        console.error=()=>{};
        await agentListeners.get('message')({ type: 'load_conversation', payload: { chat: { id: 303, chat_id: 'chat-c' }, filters: {} } });
        await agentListeners.get('message')({ type: 'export_conversation', payload: { chatId: 'chat-c' } });
        await agentListeners.get('message')({ type: 'send_chat_message', payload: { type: 'text', msgCon: { text: { body: 'unauthorized synthetic reply' } }, chatInfo: { id: 303, chat_id: 'chat-c', sender_mobile: '5550003', origin: 'meta' } } });
        await agentListeners.get('message')({ type: 'add_label', payload: { label: 'Unauthorized tenant label', hex: '#000000' } });
        await agentListeners.get('message')({ type: 'on_label_delete', payload: { labelId: 10 } });
      } finally { console.error=originalConsoleError; }
      const [unassignedChat] = await db.query('SELECT unread_count FROM beta_chats WHERE uid=? AND id=?', [ownerA, 303]);
      const [agentLabels] = await db.query('SELECT COUNT(*) AS count FROM chat_tags WHERE uid=?', [ownerA]);
      const [tenantBLabel] = await db.query('SELECT COUNT(*) AS count FROM chat_tags WHERE uid=? AND id=?', [ownerB, 10]);
      assert.equal(unassignedChat[0].unread_count, 3, 'guessed read of another agent chat does not clear unread state');
      assert.equal(agentLabels[0].count, 0, 'legacy agent cannot add a tenant-wide label');
      assert.equal(tenantBLabel[0].count, 1, 'legacy agent cannot delete another tenant label');
      assert.equal(agentEmitted.filter(item => item.event === 'load_conversation').length, 0);
      assert.equal(agentEmitted.filter(item => item.event === 'export_conversation_result').length, 0);
      assert.equal(agentEmitted.filter(item => item.event === 'error').length, 5, 'direct read, export, reply and tenant-wide label writes are denied');

      console.log(JSON.stringify({ success: true, database, mysqlVersion: (await db.query('SELECT VERSION() AS version'))[0][0].version, syntheticTenants: 2, crossTenantMutations: 0, customerDataTouched: false, externalWrites: false }));
    } finally {
      for (const filename of modulePaths) {
        if (priorModules.get(filename)) require.cache[filename] = priorModules.get(filename);
        else delete require.cache[filename];
      }
    }
  } finally {
    if (db) await db.end();
    if (created) await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
