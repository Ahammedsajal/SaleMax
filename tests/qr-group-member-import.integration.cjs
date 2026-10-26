'use strict';
// Explicit credentials must point at the disposable test database server.
const assert = require('node:assert/strict'), crypto = require('node:crypto'), path = require('node:path');
const root = process.env.GROUP_IMPORT_SOURCE_ROOT || path.resolve(__dirname, '..');
const fromRoot = require('node:module').createRequire(path.join(root, 'package.json'));
const mysql = fromRoot('mysql2/promise');
const service = require(path.join(root, 'modules/platform/qr-group-member-import'));
if (!process.env.GROUP_IMPORT_TEST_DB_PASSWORD) throw Error('DISPOSABLE_TEST_DB_REQUIRED');
const database = 'sx_group_import_' + crypto.randomBytes(6).toString('hex');
(async () => {
  const admin = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: process.env.GROUP_IMPORT_TEST_DB_PASSWORD });
  let pool;
  try {
    await admin.query(`CREATE DATABASE \`${database}\``);
    pool = mysql.createPool({ host: '127.0.0.1', user: 'root', password: process.env.GROUP_IMPORT_TEST_DB_PASSWORD, database, connectionLimit: 4 });
    await pool.query('CREATE TABLE user(id INT AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(100) UNIQUE,plan LONGTEXT,plan_expire BIGINT) ENGINE=InnoDB');
    await pool.query('CREATE TABLE phonebook(id INT AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(100),name VARCHAR(200)) ENGINE=InnoDB');
    await pool.query('CREATE TABLE contact(id INT AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(100),phonebook_id INT,phonebook_name VARCHAR(200),name VARCHAR(200),mobile VARCHAR(100),var1 TEXT,var2 TEXT,var3 TEXT,var4 TEXT,var5 TEXT) ENGINE=InnoDB');
    await pool.query('INSERT INTO user(uid,plan,plan_expire) VALUES (?,?,?)', ['synthetic-owner', JSON.stringify({ contact_limit: 3 }), Date.now() + 86400000]);
    await pool.query("INSERT INTO phonebook(uid,name) VALUES ('synthetic-owner','Target'),('foreign-owner','Foreign')");
    const ctx = { uid: 'synthetic-owner', manage: true }, group = { participants: [{ phone: '97455550001', name: 'First' }, { phone: '97455550002', name: 'Second' }] };
    const run = async input => { const db = await pool.getConnection(); try { return await service.importMembers(db, ctx, ctx.uid, group, input); } finally { db.release(); } };
    const input = { bookId: 1, mobiles: ['97455550001', '97455550002'] };
    const results = await Promise.all([run(input), run(input)]);
    assert.equal(results.reduce((sum, result) => sum + result.imported, 0), 2);
    const [[count]] = await pool.query('SELECT COUNT(*) count FROM contact'); assert.equal(count.count, 2);
    await assert.rejects(run({ newBookName: 'Rollback target', mobiles: input.mobiles }), { code: 'CONTACT_LIMIT_EXCEEDED' });
    const [[books]] = await pool.query('SELECT COUNT(*) count FROM phonebook'); assert.equal(books.count, 2);
    await assert.rejects(run({ bookId: 2, mobiles: input.mobiles }), { code: 'PHONEBOOK_NOT_FOUND' });
    const single = await run({ newBookName: 'New book', mobiles: [input.mobiles[0]] }); assert.equal(single.imported, 1);
    console.log(JSON.stringify({ success: true, syntheticData: true, concurrentDedupe: true, atomicQuotaRollback: true, foreignBookDenied: true, newBookImport: true }));
  } finally { await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end(); }
})().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
