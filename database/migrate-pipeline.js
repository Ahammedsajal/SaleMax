require('dotenv').config({ quiet: true });
const path = require('node:path');
const { discover, applyMigrations } = require('./migration-runner');
async function main() {
  const args = process.argv.slice(2);
  const mode = args.filter(arg => ['--plan', '--apply'].includes(arg));
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
  if (mode.length !== 1 || args.filter(arg => arg === '--only').length > 1 || onlyIndex >= 0 && (!only || args.length !== 3) || onlyIndex < 0 && args.length !== 1 || only && mode[0] !== '--apply') throw Object.assign(new Error(), { code: 'USE_PLAN_OR_APPLY' });
  const migrations = discover(path.join(__dirname, 'migrations'));
  if (mode[0] !== '--apply') {
    console.log(JSON.stringify({ mode: 'plan', migrations: migrations.map(m => ({ name: m.file, checksum: m.checksum, statements: m.statements.length })) }, null, 2));
    return;
  }
  for (const key of ['DBHOST', 'DBUSER', 'DBNAME']) if (!process.env[key]) throw Object.assign(new Error(), { code: 'DATABASE_CONFIG_REQUIRED' });
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({ host: process.env.DBHOST, port: Number(process.env.DBPORT || 3306), user: process.env.DBUSER, password: process.env.DBPASS, database: process.env.DBNAME, charset: 'utf8mb4', multipleStatements: false });
  try { console.log(JSON.stringify({ mode: 'apply', ...(only ? { only } : {}), ...await applyMigrations(connection, migrations, { only }) }, null, 2)); }
  finally { await connection.end(); }
}
if (require.main === module) main().catch(error => { console.error('Migration stopped:', error.code || 'MIGRATION_FAILED'); process.exitCode = 1; });
module.exports = { main };
