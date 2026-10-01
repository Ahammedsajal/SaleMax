require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  if (process.env.LOCAL_ONLY_MODE !== 'true' || !['127.0.0.1', 'localhost', '::1'].includes(process.env.DBHOST)) throw new Error('LOCAL_ONLY');
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({ host: process.env.DBHOST, port: Number(process.env.DBPORT), user: process.env.DBUSER, password: process.env.DBPASS, database: process.env.DBNAME });
  try {
    const [columns] = await connection.query('SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,COLUMN_KEY AS columnKey,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
    const [indexes] = await connection.query('SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS position,COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX');
    const tables=[...new Set(columns.map(row=>row.tableName))];
    fs.writeFileSync(path.join(__dirname,'../docs/LEGACY_SCHEMA_INVENTORY.json'),JSON.stringify({scope:'Local structural metadata only; excludes rows, defaults, credentials and environment settings.',tables,columns,indexes},null,2)+'\n');
    console.log(JSON.stringify({ tables:tables.length, columns:columns.length, indexColumns:indexes.length, customerRowsRead:0 }));
  } finally { await connection.end(); }
}
main().catch(error=>{console.error('Schema inventory failed:',error.code||error.message);process.exitCode=1;});
