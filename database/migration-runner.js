const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
class MigrationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
// Parse single SQL statements without enabling mysql2 multipleStatements.
function splitSql(source) {
  if (/^\s*DELIMITER\b/im.test(source)) throw new MigrationError('UNSUPPORTED_DELIMITER');
  const statements = [];
  let buffer = '', quote = null, line = false, block = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (line) { if (char === '\n') { line = false; buffer += '\n'; } continue; }
    if (block) { if (char === '*' && next === '/') { block = false; i++; buffer += ' '; } continue; }
    if (quote) {
      buffer += char;
      if (char === '\\' && quote !== '`' && next !== undefined) { buffer += next; i++; }
      else if (char === quote) { if (next === quote) { buffer += next; i++; } else quote = null; }
      continue;
    }
    if (char === '/' && next === '*') {
      if (source[i + 2] === '!' || source.slice(i + 2, i + 4) === 'M!') throw new MigrationError('UNSUPPORTED_EXECUTABLE_COMMENT');
      block = true; i++; continue;
    }
    if (char === '#' || (char === '-' && next === '-' && /\s/.test(source[i + 2] || ' '))) { line = true; if (char === '-') i++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; buffer += char; continue; }
    if (char === ';') { if (buffer.trim()) statements.push(buffer.trim()); buffer = ''; }
    else buffer += char;
  }
  if (quote || block) throw new MigrationError('UNTERMINATED_SQL');
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}
function discover(directory) {
  const root = fs.realpathSync(directory);
  return fs.readdirSync(root).filter(file => /^\d{8}_[a-z0-9_]+\.sql$/i.test(file))
    .filter(file => !/(?:^|_)(?:rollback|down|revert)(?:_|\.)/i.test(file))
    .sort().map(file => {
      const filename = path.join(root, file);
      if (fs.lstatSync(filename).isSymbolicLink() || !fs.statSync(filename).isFile()) throw new MigrationError('INVALID_MIGRATION_FILE');
      const source = fs.readFileSync(filename, 'utf8');
      const statements = splitSql(source);
      if (!statements.length) throw new MigrationError('EMPTY_MIGRATION');
      if (statements.some(sql => /^(?:DROP\b|TRUNCATE\b)|\bDROP\s+(?:COLUMN|TABLE|DATABASE)\b/i.test(sql))) throw new MigrationError('DESTRUCTIVE_FORWARD_MIGRATION');
      return { file, checksum: crypto.createHash('sha256').update(source).digest('hex'), statements };
    });
}
const ledgerSql = `CREATE TABLE IF NOT EXISTS salemax_schema_migrations (
  migration_name VARCHAR(190) NOT NULL PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  statement_count INT UNSIGNED NOT NULL,
  statements_completed INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  error_code VARCHAR(100) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
async function applyMigrations(connection, migrations) {
  const [[database]] = await connection.query('SELECT DATABASE() AS db');
  if (!database.db) throw new MigrationError('DATABASE_REQUIRED');
  const lockName = 'salemax:migrate:' + crypto.createHash('sha256').update(database.db).digest('hex').slice(0, 40);
  const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
  if (Number(lock.acquired) !== 1) throw new MigrationError('MIGRATION_LOCKED');
  const applied = [], skipped = [];
  try {
    await connection.query(ledgerSql);
    const [rows] = await connection.query('SELECT * FROM salemax_schema_migrations');
    const prior = new Map(rows.map(row => [row.migration_name, row]));
    const current = new Map(migrations.map(m => [m.file, m]));
    // Check the whole history before applying any new SQL.
    for (const row of rows) {
      if (!current.has(row.migration_name)) throw new MigrationError('MIGRATION_HISTORY_MISSING');
      if (current.get(row.migration_name).checksum !== row.checksum) throw new MigrationError('MIGRATION_CHECKSUM_CHANGED');
      if (row.status !== 'applied') throw new MigrationError('MIGRATION_RECOVERY_REQUIRED');
    }
    for (const migration of migrations) {
      if (prior.has(migration.file)) { skipped.push(migration.file); continue; }
      await connection.query('INSERT INTO salemax_schema_migrations (migration_name, checksum, status, statement_count) VALUES (?, ?, ?, ?)', [migration.file, migration.checksum, 'running', migration.statements.length]);
      let completed = 0;
      try {
        for (const sql of migration.statements) {
          await connection.query(sql);
          completed++;
          await connection.query('UPDATE salemax_schema_migrations SET statements_completed = ? WHERE migration_name = ?', [completed, migration.file]);
        }
        await connection.query('UPDATE salemax_schema_migrations SET status = ?, completed_at = CURRENT_TIMESTAMP(3), error_code = NULL WHERE migration_name = ?', ['applied', migration.file]);
        applied.push(migration.file);
      } catch (error) {
        const code = /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : Number.isInteger(error.errno) ? 'DB_ERRNO_' + error.errno : 'MIGRATION_STATEMENT_FAILED';
        // MariaDB DDL may commit before its checkpoint. Failed/running blocks
        // automated retry until an operator reconciles actual schema state.
        try { await connection.query('UPDATE salemax_schema_migrations SET status = ?, error_code = ? WHERE migration_name = ?', ['failed', code, migration.file]); } catch (_) {}
        throw new MigrationError('MIGRATION_RECOVERY_REQUIRED');
      }
    }
    return { applied, skipped };
  } finally { try { await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch (_) {} }
}
module.exports = { MigrationError, splitSql, discover, applyMigrations };
