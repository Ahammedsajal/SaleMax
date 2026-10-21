'use strict';

const path = require('node:path');
const { readTenantAdoptionSnapshot } = require('../modules/platform/tenant-adoption-audit');

async function main() {
  const configPath = process.env.SALEMAX_DATABASE_CONFIG || path.resolve(__dirname, '../database/config.js');
  const pool = require(configPath);
  const connection = await pool.promise().getConnection();
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const snapshot = await readTenantAdoptionSnapshot(connection);
    await connection.commit();
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    await connection.rollback().catch(() => {});
    process.stderr.write(`${error.code || 'TENANT_ADOPTION_AUDIT_FAILED'}\n`);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error.code || 'TENANT_ADOPTION_AUDIT_FAILED'}\n`);
  process.exitCode = 1;
});
