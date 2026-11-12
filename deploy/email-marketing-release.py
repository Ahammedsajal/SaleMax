#!/usr/bin/env python3
"""Guarded 7Network Sales Email release; run under with-production-lock.sh."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
APP = 'salemax-app-1'
DB = 'salemax-db-1'
WORKER = 'salemax-report-worker-1'
SUPPORT = (DB, WORKER, 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1',
           'salemax-bot-lead-test-db')
EXPECTED_IMAGE = 'salemax-app:openai-ads-lead-01fde9e1-20261103'
EXPECTED_IMAGE_ID = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
EXPECTED_HEAD = '/opt/salemax/releases/database-pool-budget-6b9af8a42ec9-20261112/compose.database-pool-recovery.json'
MIGRATION = 'database/migrations/20270106_email_marketing.sql'
MIGRATION_NAME = Path(MIGRATION).name
IMAGE_DOCKERFILE = 'deploy/Dockerfile.email-marketing-sdk'
RUNTIME_FILES = (
    'client/public/index.html',
    'client/public/workspace-api.js',
    'client/public/phonebook-workspace.css',
    'client/public/phonebook-workspace.js',
    'client/public/email-marketing-workspace.css',
    'client/public/email-marketing-workspace.js',
    'client/public/admin-email-marketing-settings.js',
    'modules/platform/categories.js',
    'modules/platform/feature-contract.js',
    'modules/platform/mount-existing-upgrade.js',
    'modules/platform/navigation.js',
    'modules/platform/phonebook-import.js',
    'modules/platform/phonebook-workspace-router.js',
    'modules/platform/phonebook-workspace.js',
    'modules/platform/policy.js',
    'modules/platform/email-marketing.js',
    'modules/platform/email-marketing-ses.js',
    'modules/platform/email-marketing-worker.js',
    'modules/platform/email-marketing-router.js',
    'modules/platform/email-marketing-admin-router.js',
    'modules/platform/email-marketing-provider-settings.js',
)
TARGETS = (*RUNTIME_FILES, MIGRATION)
PREIMAGES = {
    'client/public/index.html': 'd3d3eecc269d187de94f8990772cdb0449ddeea540535aaeec8e03508d94b7a7',
    'client/public/workspace-api.js': '05dda5e0c1aa32796cb7acb30c12188f772e11755b5e6f63ef6a88f27cc1c866',
    'client/public/phonebook-workspace.css': 'd280821db43ed34219de7d55c8d5477f676018f4bee64a31f8b28102161b30be',
    'client/public/phonebook-workspace.js': '08d045a8058342ef99b312b19e2c1545ef4b3bdb6371027a7abd5071b3f22cd3',
    'modules/platform/categories.js': '8c4073b1555d2b52320a50292aa0e8fbed97157f3f442b0fc20a272de6dd0ea3',
    'modules/platform/feature-contract.js': '782eba93dc8e61ad84f74a40ea0cfd76336e5c4e40796eab467ec9104d3b1517',
    'modules/platform/mount-existing-upgrade.js': '53836f480415aa4a977302bf5ab8c0bb8d159510d584038b3a2046eaba0b22c8',
    'modules/platform/navigation.js': '62edfbe5e79cdb573a74936c2093c712fcbc9f6bc04ed21a3e32deac77b609d0',
    'modules/platform/phonebook-import.js': 'a615ce06548161eed671bb9be60e634c845ca94140df7661c496ad6cf0345d61',
    'modules/platform/phonebook-workspace-router.js': '7508360e2864f18b117011916a3ea3837292bea85dbf6cf1163f7ae0b0128af9',
    'modules/platform/phonebook-workspace.js': 'bb89aeff0e75f1173db9aa20b38e347be50b7fb546e24a48372dea87b3baeeef',
    'modules/platform/policy.js': 'aee8a1d51bb5e99358c9a7eaae574b4e634fe9673b02f6cda44f30ba0437f6fc',
}
NEW_FILES = tuple(name for name in TARGETS if name not in PREIMAGES)
EMAIL_TABLES = (
    'sx_email_sender_domains', 'sx_email_senders', 'sx_email_templates',
    'sx_email_attachments', 'sx_email_template_attachments', 'sx_email_campaigns',
    'sx_email_campaign_attachments', 'sx_email_campaign_recipients',
    'sx_email_suppressions', 'sx_email_consent_events', 'sx_email_threads',
    'sx_email_messages', 'sx_platform_email_provider_settings',
)
CONTACT_EMAIL_COLUMNS = (
    'email', 'email_marketing_consent', 'email_marketing_consent_at',
    'email_marketing_consent_source', 'email_unsubscribed_at',
)
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
SDK_VERSION = '3.1166.0'
SES_NODE_PATH = '/opt/7network-email-node-modules/node_modules'
BASE_NODE_PATH = '/app/.mcp-node-modules/node_modules'
MINIMUM_FREE_BYTES = 1024 * 1024 * 1024
FAILED_EMAIL_COMMIT = '804a292172c6cc99cc94099349b0d3b2782f73c3'
FAILED_EMAIL_CHECKSUM = '6e2f6bce4f87fbd3fe0b74ad1bcf00ee1f8b1b3515ac34d404d95dff025e6106'
FAILED_EMAIL_MIGRATION = 'database/migrations/20270106_email_marketing.sql'
FAILED_EMAIL_BACKUP = ROOT / 'shared/rollback-email-marketing-804a292172c6-20261112'
FAILED_EMAIL_PARTIAL_TABLE = 'sx_platform_email_provider_settings'
FAILED_EMAIL_PARTIAL_COLUMNS = (
    'provider_key', 'region', 'access_key_ciphertext', 'access_key_iv',
    'access_key_tag', 'secret_key_ciphertext', 'secret_key_iv', 'secret_key_tag',
    'revision', 'updated_by_identity_id', 'created_at', 'updated_at',
)


def run(*args, env=None, input_text=None, timeout=None, log_path=None):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True,
                            text=True, timeout=timeout)
    if log_path:
        target = Path(log_path)
        target.write_text(result.stdout + result.stderr)
        target.chmod(0o600)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed ({result.returncode})')
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_private(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def service_compose(info, service):
    labels = info.get('Config', {}).get('Labels') or {}
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != service:
        raise RuntimeError('Unexpected Compose service identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if not workdir or not files or not env_files or not all(Path(path).is_file() for path in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return {'files': files, 'env_files': env_files, 'workdir': workdir}


def compose_args(meta):
    args = ['docker', 'compose', '--project-name', 'salemax',
            '--project-directory', meta['workdir']]
    for name in meta['env_files']:
        args += ['--env-file', name]
    for name in meta['files']:
        args += ['-f', name]
    return args


def compose_environment(info, meta):
    live = dict(item.split('=', 1) for item in info['Config'].get('Env', []) if '=' in item)
    supplied = {key for name in meta['env_files']
                for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in meta['files']
                  for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    manual = json.loads(MANUAL_VARS.read_text()) if MANUAL_VARS.is_file() else {}
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live:
            variables[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation input')
    effective = dict(os.environ)
    for key in referenced:
        effective.pop(key, None)
    effective.update(variables)
    return effective, variables


def environment_map(service):
    value = service.get('environment') or {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, list):
        result = {}
        for item in value:
            key, separator, content = item.partition('=')
            if not separator:
                raise RuntimeError('Compose environment entry is invalid')
            result[key] = content
        return result
    raise RuntimeError('Compose environment format is unsupported')


def support_ids():
    return {name: inspect(name)['Id'] for name in SUPPORT}


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or base release changed')


def compose_up(meta, env, overlays=()):
    args = compose_args(meta)
    for overlay in overlays:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
        env=env, timeout=300)


def wait_app():
    for _ in range(60):
        info = inspect(APP)
        if info['State'].get('Health', {}).get('Status') == 'healthy':
            return info
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def container_hash(name):
    return run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]


def container_has(path):
    result = subprocess.run(['docker', 'exec', APP, 'test', '-e', '/app/' + path],
                            capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise RuntimeError('Container path probe failed')
    return result.returncode == 0


def database_state(expected_email_checksum=None):
    script = r"""
const runner=require('/app/database/migration-runner');
const mysql=require('mysql2/promise');
const emailTables=%s;
const contactColumns=%s;
const emailMigrationName=%s;
const emailMigrationChecksum=%s;
(async()=>{
 const connection=await mysql.createConnection({
  host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,
  password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4',multipleStatements:false
 });
 try{
 const migrations=runner.discover('/app/database/migrations');
 const [ledger]=await connection.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations');
 const [tables]=await connection.query('SELECT TABLE_NAME AS name,TABLE_ROWS AS rowsCount,DATA_LENGTH AS dataBytes,INDEX_LENGTH AS indexBytes FROM information_schema.tables WHERE table_schema=DATABASE()');
 const [columns]=await connection.query("SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='contact'");
 const available=new Map(migrations.map(row=>[row.file,row]));
 if(emailMigrationChecksum){
  const found=available.get(emailMigrationName);
  if(found&&found.checksum!==emailMigrationChecksum)throw Object.assign(Error(),{code:'EXPECTED_EMAIL_MIGRATION_CHECKSUM_MISMATCH'});
  available.set(emailMigrationName,{file:emailMigrationName,checksum:emailMigrationChecksum});
 }
 const known=ledger.filter(row=>available.has(row.migration_name));
 const tableNames=new Set(tables.map(row=>row.name));
 const currentEmailTables=[];
 for(const name of emailTables){
  if(tableNames.has(name)){
   const [count]=await connection.query('SELECT COUNT(*) AS rowsCount FROM '+name);
   currentEmailTables.push({name,rows:Number(count[0].rowsCount)});
  }
 }
 const result={
  migrationFiles:available.size,ledgerRows:ledger.length,
  historyMissing:ledger.filter(row=>!available.has(row.migration_name)).length,
  historyChecksumMismatch:known.filter(row=>available.get(row.migration_name).checksum!==row.checksum).length,
  historyIncomplete:ledger.filter(row=>row.status!=='applied').length,
  migration:ledger.find(row=>row.migration_name===emailMigrationName)||null,
  emailTables:currentEmailTables,
  providerSettingsRows:currentEmailTables.find(row=>row.name==='sx_platform_email_provider_settings')?.rows||0,
  contactColumns:columns.map(row=>row.name).filter(name=>contactColumns.includes(name)),
  contactTableBytes:(tables.find(row=>row.name==='contact')||{}).dataBytes||0,
  contactIndexBytes:(tables.find(row=>row.name==='contact')||{}).indexBytes||0
 };
 console.log(JSON.stringify(result));
 }finally{await connection.end();}
})().catch(error=>{console.log(JSON.stringify({probeError:error.code||error.name||'DATABASE_PROBE_FAILED'}));process.exitCode=1});
""" % (json.dumps(list(EMAIL_TABLES)), json.dumps(list(CONTACT_EMAIL_COLUMNS)),
       json.dumps(MIGRATION_NAME), json.dumps(expected_email_checksum))
    for attempt in range(6):
        execution = subprocess.run(['docker', 'exec', APP, 'node', '-e', script],
                                   capture_output=True, text=True, timeout=60)
        result = None
        for line in reversed(execution.stdout.splitlines()):
            try:
                result = json.loads(line)
                break
            except json.JSONDecodeError:
                continue
        if execution.returncode == 0 and result is not None:
            if result.get('probeError'):
                raise RuntimeError(str(result['probeError']))
            return result
        code = result.get('probeError') if isinstance(result, dict) else None
        if code == 'ER_CON_COUNT_ERROR' and attempt < 5:
            time.sleep(5)
            continue
        raise RuntimeError(code if isinstance(code, str) and re.fullmatch(r'[A-Z0-9_]{1,80}', code)
                           else 'DATABASE_PREFLIGHT_FAILED')
    raise RuntimeError('DATABASE_CONNECTION_LIMIT')


def apply_migration(sql, filename):
    filename = Path(filename).name
    if not re.fullmatch(r'\d{8}_[a-z0-9_]+\.sql', filename):
        raise RuntimeError('Invalid migration filename')
    script = r"""
let body='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',part=>body+=part);
process.stdin.on('end',async()=>{
 let connection;
 try{
  const input=JSON.parse(body);
  const runner=require('/app/database/migration-runner');
  const crypto=require('node:crypto');
  const checksum=crypto.createHash('sha256').update(input.sql,'utf8').digest('hex');
  const migrations=runner.discover('/app/database/migrations');
  const existing=migrations.find(row=>row.file===input.filename);
  if(existing&&existing.checksum!==checksum)throw Object.assign(Error('MIGRATION_CHECKSUM_CHANGED'),{code:'MIGRATION_CHECKSUM_CHANGED'});
  if(!existing)migrations.push({file:input.filename,checksum,statements:runner.splitSql(input.sql)});
  migrations.sort((left,right)=>left.file.localeCompare(right.file));
  const mysql=require('mysql2/promise');
  connection=await mysql.createConnection({
   host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,
   password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4',multipleStatements:false
  });
  const applied=await runner.applyMigrations(connection,migrations,{only:input.filename});
  const [rows]=await connection.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[input.filename]);
  console.log(JSON.stringify({applied,migration:rows[0]||null}));
 }catch(error){console.log(JSON.stringify({migrationError:error.code||error.name||'MIGRATION_FAILED'}));process.exitCode=1}
 finally{try{await connection?.end()}catch{}}
});
"""
    payload = json.dumps({'filename': filename, 'sql': sql})
    execution = subprocess.run(['docker', 'exec', '-i', APP, 'node', '-e', script],
                               input=payload, capture_output=True, text=True, timeout=900)
    output = execution.stdout
    for line in reversed(output.splitlines()):
        try:
            result = json.loads(line)
            if 'migration' in result:
                return result
            if 'migrationError' in result:
                raise RuntimeError(str(result['migrationError']))
        except json.JSONDecodeError:
            continue
    if execution.returncode:
        raise RuntimeError('MIGRATION_FAILED')
    raise RuntimeError('Migration runner returned no result')


def recover_failed_email_migration(backup):
    require_lock()
    backup = Path(backup).resolve()
    if backup != FAILED_EMAIL_BACKUP.resolve():
        raise RuntimeError('Unexpected failed Email rollback directory')
    release_info = json.loads((backup / 'release.json').read_text())
    before_schema = json.loads((backup / 'schema-before.json').read_text())
    if (release_info.get('sourceCommit') != FAILED_EMAIL_COMMIT
            or release_info.get('migration') != FAILED_EMAIL_MIGRATION
            or release_info.get('migrationChecksum') != FAILED_EMAIL_CHECKSUM
            or before_schema.get('historyIncomplete') != 0
            or before_schema.get('emailTables')
            or before_schema.get('contactColumns')):
        raise RuntimeError('Failed Email attempt does not match the reviewed recovery')

    app = inspect(APP)
    db = inspect(DB)
    meta = service_compose(app, 'app')
    if (app['Config']['Image'] != EXPECTED_IMAGE or app['Image'] != EXPECTED_IMAGE_ID
            or app['State'].get('Health', {}).get('Status') != 'healthy'
            or db['State'].get('Health', {}).get('Status') != 'healthy'
            or meta['files'][-1] != EXPECTED_HEAD):
        raise RuntimeError('Active production release differs from the reviewed baseline')
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('A support service changed after the failed Email attempt')
    input_hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Production Compose inputs changed after the failed Email attempt')
    for name, expected in PREIMAGES.items():
        if container_hash(name) != expected:
            raise RuntimeError('Active application files differ from the reviewed baseline')

    script = r"""
let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',p=>body+=p);
process.stdin.on('end',async()=>{
 let c,lockName;
 try{
  const input=JSON.parse(body),mysql=require('mysql2/promise'),crypto=require('node:crypto');
  const expectedName='database/migrations/20270106_email_marketing.sql';
  const expectedChecksum='6e2f6bce4f87fbd3fe0b74ad1bcf00ee1f8b1b3515ac34d404d95dff025e6106';
  const partialTable=%s;
  const expectedColumns=%s,allEmailTables=%s;
  c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4',multipleStatements:false});
  const [[db]]=await c.query('SELECT DATABASE() AS db');
  lockName='salemax:migrate:'+crypto.createHash('sha256').update(db.db).digest('hex').slice(0,40);
  const [[lock]]=await c.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]);
  if(Number(lock.acquired)!==1)throw Object.assign(Error(),{code:'MIGRATION_LOCKED'});
  const [ledgerRows]=await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed,error_code,started_at,completed_at FROM salemax_schema_migrations WHERE migration_name=?',[expectedName]);
  if(ledgerRows.length>1)throw Object.assign(Error(),{code:'RECOVERY_SCOPE_MISMATCH'});
  const [tableRows]=await c.query('SELECT TABLE_NAME,ENGINE,ROW_FORMAT FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_NAME IN (?)',[allEmailTables]);
  const present=tableRows.map(x=>x.TABLE_NAME).sort();
  const [contactRows]=await c.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='contact' AND column_name IN ('email','email_marketing_consent','email_marketing_consent_at','email_marketing_consent_source','email_unsubscribed_at')");
  const hasPartial=present.includes(partialTable);
  let partial=null;
  if(hasPartial){
   const [[count]]=await c.query('SELECT COUNT(*) AS n FROM '+partialTable);
   const [columns]=await c.query('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION',[partialTable]);
   const [indexes]=await c.query('SELECT DISTINCT INDEX_NAME FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? ORDER BY INDEX_NAME',[partialTable]);
   const [ddl]=await c.query('SHOW CREATE TABLE '+partialTable);
   const tableMeta=tableRows.find(x=>x.TABLE_NAME===partialTable);
   partial={rowCount:Number(count.n),engine:tableMeta.ENGINE,rowFormat:tableMeta.ROW_FORMAT,
    columns:columns.map(x=>x.COLUMN_NAME),indexes:indexes.map(x=>x.INDEX_NAME),createSql:ddl[0]['Create Table']};
   const expectedIndexes=['fk_sx_platform_email_provider_updater','PRIMARY'];
   if(partial.rowCount!==0||partial.engine!=='InnoDB'||partial.rowFormat!=='Dynamic'
      ||JSON.stringify(partial.columns)!==JSON.stringify(expectedColumns)
      ||partial.indexes.length!==expectedIndexes.length||expectedIndexes.some(name=>!partial.indexes.includes(name)))
    throw Object.assign(Error(),{code:'PARTIAL_TABLE_NOT_EMPTY_OR_CHANGED'});
  }
  if(present.some(name=>name!==partialTable)||contactRows.length)
   throw Object.assign(Error(),{code:'RECOVERY_SCOPE_MISMATCH'});
  const row=ledgerRows[0]||null;
  if(row&& (row.checksum!==expectedChecksum||row.status!=='failed'||Number(row.statement_count)!==14
      ||Number(row.statements_completed)!==1||row.error_code!=='ER_TOO_LONG_KEY'))
   throw Object.assign(Error(),{code:'FAILED_MIGRATION_ROW_CHANGED'});
  if(input.action==='inspect'){
   if(!row&&!hasPartial){console.log(JSON.stringify({state:'already_recovered'}));return;}
   if(!row)throw Object.assign(Error(),{code:'RECOVERY_LEDGER_MISSING'});
   console.log(JSON.stringify({state:hasPartial?'ready':'row_only',migration:row,partialTable:partial,emailTables:present,contactColumns:contactRows.map(x=>x.COLUMN_NAME)}));
  }else if(input.action==='recover'){
   if(!row&&!hasPartial){console.log(JSON.stringify({state:'already_recovered'}));return;}
   if(!row)throw Object.assign(Error(),{code:'RECOVERY_LEDGER_MISSING'});
   if(hasPartial)await c.query('DROP TABLE '+partialTable);
   const [deleted]=await c.query('DELETE FROM salemax_schema_migrations WHERE migration_name=? AND checksum=? AND status=? AND statement_count=? AND statements_completed=? AND error_code=?',[expectedName,expectedChecksum,'failed',14,1,'ER_TOO_LONG_KEY']);
   if(Number(deleted.affectedRows)!==1)throw Object.assign(Error(),{code:'RECOVERY_LEDGER_CHANGED'});
   const [remaining]=await c.query('SELECT COUNT(*) AS n FROM salemax_schema_migrations WHERE migration_name=?',[expectedName]);
   const [remainingTables]=await c.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',[partialTable]);
   if(Number(remaining[0].n)!==0||Number(remainingTables[0].n)!==0)throw Object.assign(Error(),{code:'RECOVERY_VERIFY_FAILED'});
   console.log(JSON.stringify({state:'recovered',removedRows:Number(deleted.affectedRows),removedEmptyTable:hasPartial}));
  }else throw Object.assign(Error(),{code:'INVALID_RECOVERY_ACTION'});
 }catch(e){console.log(JSON.stringify({recoveryError:e.code||e.name||'RECOVERY_FAILED'}));process.exitCode=1}
 finally{try{if(c&&lockName)await c.query('SELECT RELEASE_LOCK(?)',[lockName]);await c?.end()}catch{}}
});
""" % (json.dumps(FAILED_EMAIL_PARTIAL_TABLE), json.dumps(list(FAILED_EMAIL_PARTIAL_COLUMNS)),
       json.dumps(list(EMAIL_TABLES)))
    def run_recovery(action):
        execution = subprocess.run(['docker', 'exec', '-i', APP, 'node', '-e', script],
                                   input=json.dumps({'action': action}), capture_output=True,
                                   text=True, timeout=120)
        result = None
        for line in reversed(execution.stdout.splitlines()):
            try:
                result = json.loads(line)
                break
            except json.JSONDecodeError:
                continue
        if execution.returncode or result is None:
            code = result.get('recoveryError') if isinstance(result, dict) else None
            raise RuntimeError(code if isinstance(code, str) and re.fullmatch(r'[A-Z0-9_]{1,80}', code)
                               else 'EMAIL_MIGRATION_RECOVERY_FAILED')
        if result.get('recoveryError'):
            raise RuntimeError(result['recoveryError'])
        return result

    snapshot = run_recovery('inspect')
    if snapshot.get('state') == 'already_recovered':
        print(json.dumps(snapshot))
        return
    snapshot.update({'sourceCommit': FAILED_EMAIL_COMMIT,
                     'recordedAtUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    recovery_record = backup / 'partial-migration-before-recovery.json'
    if not recovery_record.exists():
        write_private(recovery_record, snapshot)
    result = run_recovery('recover')
    write_private(backup / 'partial-migration-recovery-result.json', result)
    print(json.dumps(result))


def verify_overlay(meta, env, overlay, mounts, app_config):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(common + ['-f', str(overlay), 'config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Candidate Compose changes the service set')
    old = copy.deepcopy(before['services']['app'])
    new = copy.deepcopy(after['services']['app'])
    if before['services']['app'].get('image') != EXPECTED_IMAGE or new.get('image') != app_config['image']:
        raise RuntimeError('Candidate Compose image differs from the reviewed app')
    old_environment = environment_map(old)
    new_environment = environment_map(new)
    if (old_environment.get('NODE_PATH', app_config['baseNodePath']) != app_config['baseNodePath']
            or new_environment.get('NODE_PATH') != app_config['nodePath']):
        raise RuntimeError('Candidate Compose has an unexpected Node module path')
    old_environment.pop('NODE_PATH', None)
    new_environment.pop('NODE_PATH', None)
    old['environment'] = old_environment
    new['environment'] = new_environment
    old_mounts = {row['target']: row for row in old.get('volumes', [])}
    expected = dict(old_mounts)
    for target, mount in mounts.items():
        if target in old_mounts:
            prior = old_mounts[target]
            prior_source = prior.get('source')
            source_name = target.removeprefix('/app/')
            expected_hash = PREIMAGES.get(source_name)
            if (prior.get('type') != 'bind' or prior.get('read_only') is not True
                    or not prior_source or not expected_hash
                    or not Path(prior_source).is_file()
                    or sha(Path(prior_source).read_bytes()) != expected_hash):
                raise RuntimeError('Candidate Compose would replace an unreviewed app mount')
        elif target.removeprefix('/app/') in PREIMAGES:
            if container_hash(target.removeprefix('/app/')) != PREIMAGES[target.removeprefix('/app/')]:
                raise RuntimeError('Candidate Compose would replace an unreviewed app file')
        expected[target] = mount
    actual = {row['target']: row for row in new.get('volumes', [])}
    if set(actual) != set(expected):
        raise RuntimeError('Candidate Compose has unexpected mount targets')
    for target, row in actual.items():
        want = expected[target]
        if (row.get('type'), row.get('source'), row.get('read_only')) != (
                want.get('type'), want.get('source'), want.get('read_only')):
            raise RuntimeError('Candidate Compose has an unexpected mount')
    old.pop('volumes', None)
    new.pop('volumes', None)
    old.pop('image', None)
    new.pop('image', None)
    if old != new:
        raise RuntimeError('Candidate Compose changes app configuration beyond image and reviewed mounts')


def validate_preflight(app, worker, db, meta, migration_state, expected_email_checksum):
    if app['Config']['Image'] != EXPECTED_IMAGE or app['Image'] != EXPECTED_IMAGE_ID:
        raise RuntimeError('Active app image differs from the reviewed baseline')
    if app['State'].get('Status') != 'running' or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app is not healthy')
    if worker['State'].get('Status') != 'running' or db['State'].get('Status') != 'running':
        raise RuntimeError('Database or report-worker is not running')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if meta['files'][-1] != EXPECTED_HEAD:
        raise RuntimeError('A newer app overlay is active')
    if migration_state.get('historyMissing') or migration_state.get('historyChecksumMismatch') or migration_state.get('historyIncomplete'):
        raise RuntimeError('Existing database migration history needs reconciliation')
    if int(migration_state.get('contactTableBytes') or 0) > 8 * 1024 * 1024 * 1024:
        raise RuntimeError('Contact table size requires a separately reviewed online migration')
    migration = migration_state.get('migration')
    if migration is None:
        if migration_state.get('emailTables') or migration_state.get('contactColumns'):
            raise RuntimeError('Email schema exists without its reviewed migration')
        return 'clean'
    expected_tables = set(EMAIL_TABLES)
    actual_tables = {row['name'] for row in migration_state.get('emailTables', [])}
    if (migration.get('status') == 'applied'
            and migration.get('checksum') == expected_email_checksum
            and int(migration.get('statement_count') or 0) == 14
            and int(migration.get('statements_completed') or 0) == 14
            and actual_tables == expected_tables
            and set(migration_state.get('contactColumns', [])) == set(CONTACT_EMAIL_COLUMNS)
            and all(int(row.get('rows') or 0) == 0 for row in migration_state.get('emailTables', []))
            and int(migration_state.get('providerSettingsRows') or 0) == 0):
        return 'already_applied'
    raise RuntimeError('Email migration state differs from the reviewed additive schema')


def verify_runtime(contents, overlay, candidate_image, expected_migration, expected_node_path,
                   before_schema, support):
    current = wait_app()
    if current['Config']['Image'] != candidate_image:
        raise RuntimeError('Candidate app image is not active')
    if current['Config'].get('Env', []).count('NODE_PATH=' + expected_node_path) != 1:
        raise RuntimeError('SES runtime dependency path is missing')
    for name, data in contents.items():
        if container_hash(name) != sha(data):
            raise RuntimeError('Runtime Email release file hash mismatch')
    modules = [name for name in RUNTIME_FILES if name.endswith('.js') and name.startswith('modules/')]
    for name in modules:
        run('docker', 'exec', APP, 'node', '--check', '/app/' + name, timeout=60)
    probe = "require.resolve('@aws-sdk/client-sesv2');require('/app/modules/platform/email-marketing-ses');require('/app/modules/platform/email-marketing-worker');require('/app/modules/platform/email-marketing-router');require('/app/modules/platform/email-marketing-admin-router');"
    run('docker', 'exec', APP, 'node', '-e', probe, timeout=60)
    if current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlay):
        raise RuntimeError('Email Compose overlay is not active')
    if support_ids() != support:
        raise RuntimeError('A support service changed during release')

    after_schema = database_state(expected_migration)
    expected_tables = set(EMAIL_TABLES)
    actual_tables = {row['name'] for row in after_schema.get('emailTables', [])}
    migration = after_schema.get('migration') or {}
    if actual_tables != expected_tables or set(after_schema.get('contactColumns', [])) != set(CONTACT_EMAIL_COLUMNS):
        raise RuntimeError('Email database schema differs from the reviewed migration')
    if (migration.get('status') != 'applied'
            or migration.get('checksum') != expected_migration
            or int(migration.get('statement_count') or 0) != int(migration.get('statements_completed') or -1)):
        raise RuntimeError('Email migration is not fully applied')
    if after_schema.get('historyMissing') or after_schema.get('historyChecksumMismatch') or after_schema.get('historyIncomplete'):
        raise RuntimeError('Database migration history changed unexpectedly')
    if any(int(row['rows']) != 0 for row in after_schema['emailTables']):
        raise RuntimeError('Unexpected records appeared during Email rollout')
    if int(after_schema.get('providerSettingsRows') or 0) != 0:
        raise RuntimeError('Unexpected AWS provider credentials were saved during release')

    run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null', timeout=30)
    user_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
                      'https://7network.live/user?page=campaign-dashboard&channel=email', timeout=30).strip()
    workspace_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
                           'https://7network.live/api/workspace/email-marketing/setup', timeout=30).strip()
    admin_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
                       'https://7network.live/api/admin/email-marketing-settings/', timeout=30).strip()
    admin_body = run('curl', '-sS', '-H', 'Accept: application/json',
                     'https://7network.live/api/admin/email-marketing-settings/', timeout=30)
    try:
        admin_result = json.loads(admin_body)
    except json.JSONDecodeError:
        admin_result = {}
    admin_denied = (admin_status in ('401', '403') or
                    (admin_status == '200' and admin_result.get('success') is False
                     and admin_result.get('logout') is True))
    if user_status != '200' or workspace_status not in ('401', '403') or not admin_denied:
        raise RuntimeError(f'Email route status check failed user={user_status} '
                           f'workspace={workspace_status} admin={admin_status}')
    served = {}
    requests = {
        'client/public/index.html': 'https://7network.live/user?page=campaign-dashboard&channel=email&asset-check=20261112-email-marketing2',
        'client/public/workspace-api.js': 'https://7network.live/workspace-api.js?v=20261112-email-marketing2',
        'client/public/phonebook-workspace.css': 'https://7network.live/phonebook-workspace.css?v=20261112-email-marketing2',
        'client/public/phonebook-workspace.js': 'https://7network.live/phonebook-workspace.js?v=20261112-email-marketing2',
        'client/public/email-marketing-workspace.css': 'https://7network.live/email-marketing-workspace.css?v=20261112-email-marketing2',
        'client/public/email-marketing-workspace.js': 'https://7network.live/email-marketing-workspace.js?v=20261112-email-marketing2',
        'client/public/admin-email-marketing-settings.js': 'https://7network.live/admin-email-marketing-settings.js?v=20261112-email-marketing2',
    }
    for name, url in requests.items():
        body = run('curl', '-fsS', '-H', 'Cache-Control: no-cache', url,
                   timeout=60).encode()
        served[name] = sha(body)
        if served[name] != sha(contents[name]):
            raise RuntimeError(f'Public Email asset hash differs from the release: {name}')
    result = {
        'appHealth': current['State'].get('Health', {}).get('Status'),
        'appImage': current['Config']['Image'],
        'appImageId': current['Image'],
        'appId': current['Id'],
        'appRestarts': current['RestartCount'],
        'appFiles': {name: sha(data) for name, data in contents.items()},
        'servedAssets': served,
        'supportServicesUnchanged': True,
        'healthz': '200',
        'userEmailRoute': user_status,
        'anonymousWorkspaceApi': workspace_status,
        'anonymousAdminApi': admin_status,
        'migration': migration,
        'schemaTables': sorted(actual_tables),
        'sesCredentialsConfigured': int(after_schema.get('providerSettingsRows') or 0) > 0,
    }
    return result


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    manifest_path = stage / 'manifest.json'
    if not manifest_path.is_file():
        raise RuntimeError('Staging manifest is missing')
    manifest = json.loads(manifest_path.read_text())
    expected_files = list(TARGETS) + [IMAGE_DOCKERFILE]
    if manifest.get('sourceCommit') != commit or manifest.get('files') != expected_files:
        raise RuntimeError('Staging manifest does not match the requested source commit')
    staged = {}
    for name in expected_files:
        path = stage / name
        if not path.is_file() or path.is_symlink():
            raise RuntimeError('Staging directory is missing a reviewed source file')
        data = path.read_bytes()
        if manifest.get('sha256', {}).get(name) != sha(data):
            raise RuntimeError('Staging file hash differs from its manifest')
        staged[name] = data
    contents = {name: staged[name] for name in TARGETS}
    migration_source = staged[MIGRATION].decode('utf-8')
    migration_checksum = sha(staged[MIGRATION])

    app, worker, db = inspect(APP), inspect(WORKER), inspect(DB)
    meta = service_compose(app, 'app')
    initial_schema = database_state(migration_checksum)
    validate_preflight(app, worker, db, meta, initial_schema, migration_checksum)
    if shutil.disk_usage(ROOT).free < MINIMUM_FREE_BYTES:
        raise RuntimeError('Insufficient production disk space')
    for name, expected in PREIMAGES.items():
        if container_hash(name) != expected:
            raise RuntimeError('Active application file differs from the reviewed preimage')
    existing_mounts = {row.get('Destination') for row in app.get('Mounts', [])}
    for name in NEW_FILES:
        if '/app/' + name in existing_mounts or container_has(name):
            raise RuntimeError('New Email runtime path already exists in production')
    if container_has(MIGRATION):
        raise RuntimeError('Email migration file already exists in the active app')
    previous_node_paths = [item.partition('=')[2] for item in app['Config'].get('Env', [])
                           if item.startswith('NODE_PATH=')]
    if previous_node_paths != [BASE_NODE_PATH]:
        raise RuntimeError('Active application Node module path differs from the reviewed baseline')
    candidate_node_path = SES_NODE_PATH + ':' + BASE_NODE_PATH

    date = time.strftime('%Y%m%d', time.gmtime())
    release = ROOT / 'releases' / f'email-marketing-{commit[:12]}-{date}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-{commit[:12]}-{date}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    env, variables = compose_environment(app, meta)
    support = support_ids()
    inputs = sorted(set(meta['files'] + meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    for name, expected in PREIMAGES.items():
        saved = preimages / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        run('docker', 'cp', f'{APP}:/app/{name}', str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Rollback preimage hash mismatch')
    write_private(backup / 'app-before.json', {
        'id': app['Id'], 'image': app['Config']['Image'], 'imageId': app['Image'],
        'inspect': app, 'compose': meta,
    })
    write_private(backup / 'compose-input-hashes.json', input_hashes)
    write_private(backup / 'compose-vars.json', variables)
    write_private(backup / 'support-services.json', support)
    write_private(backup / 'preimage-hashes.json', PREIMAGES)
    write_private(backup / 'schema-before.json', database_state(migration_checksum))
    write_private(backup / 'release-path.txt', str(release) + '\n')
    write_private(backup / 'base-release.txt', BASE + '\n')
    write_private(backup / 'source-commit.txt', commit + '\n')
    write_private(backup / 'migration-checksum.txt', migration_checksum + '\n')

    mounts = {}
    for name, data in contents.items():
        runtime = release / 'runtime' / name
        runtime.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        runtime.write_bytes(data)
        runtime.chmod(0o644)
        mounts['/app/' + name] = {
            'type': 'bind', 'source': str(runtime), 'target': '/app/' + name,
            'read_only': True, 'bind': {'create_host_path': False},
        }
    image_context = release / 'image-context'
    image_context.mkdir(mode=0o755)
    dockerfile = image_context / 'Dockerfile'
    dockerfile.write_bytes(staged[IMAGE_DOCKERFILE])
    dockerfile.chmod(0o644)
    image_tag = f'salemax-app:email-marketing-{commit[:12]}-{date}'
    overlay = release / 'compose.email-marketing.json'
    overlay.write_text(json.dumps({'services': {'app': {
        'image': image_tag, 'environment': {'NODE_PATH': candidate_node_path},
        'volumes': list(mounts.values()),
    }}}))
    overlay.chmod(0o644)
    helper = release / 'deploy' / 'email-marketing-release.py'
    helper.parent.mkdir(mode=0o755)
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)
    write_private(backup / 'release.json', {
        'sourceCommit': commit, 'baseRelease': BASE, 'baseImage': EXPECTED_IMAGE,
        'baseImageId': EXPECTED_IMAGE_ID, 'release': str(release),
        'overlay': str(overlay), 'image': image_tag, 'migration': MIGRATION,
        'migrationChecksum': migration_checksum, 'runtimeTargets': list(TARGETS),
        'imageDockerfile': IMAGE_DOCKERFILE,
    })
    verify_overlay(meta, env, overlay, mounts, {
        'image': image_tag, 'nodePath': candidate_node_path,
        'baseNodePath': BASE_NODE_PATH,
    })

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during release preparation')
    if inspect(APP)['Id'] != app['Id'] or support_ids() != support:
        raise RuntimeError('A service changed during release preparation')
    log = backup / 'build-email-sdk.log'
    run('docker', 'image', 'inspect', EXPECTED_IMAGE, timeout=30)
    base_id = run('docker', 'image', 'inspect', '--format', '{{.Id}}', EXPECTED_IMAGE).strip()
    if base_id != EXPECTED_IMAGE_ID:
        raise RuntimeError('Reviewed base image identity changed')
    run('docker', 'build', '--pull=false', '--tag', image_tag,
        '--build-arg', 'BASE_IMAGE=' + EXPECTED_IMAGE,
        '--file', str(dockerfile), str(image_context),
        timeout=1200, log_path=log)
    if inspect(APP)['Id'] != app['Id'] or support_ids() != support:
        raise RuntimeError('A service changed while building the candidate image')
    run('docker', 'run', '--rm', '--entrypoint', 'node', image_tag, '-e',
        "if(!require.resolve('@aws-sdk/client-sesv2'))process.exit(2);if(process.env.NODE_PATH!=='/opt/7network-email-node-modules/node_modules')process.exit(3)",
        timeout=60)
    image_id = run('docker', 'image', 'inspect', '--format', '{{.Id}}', image_tag).strip()
    write_private(backup / 'candidate-image.json', {
        'tag': image_tag, 'id': image_id, 'baseImage': EXPECTED_IMAGE,
        'baseImageId': EXPECTED_IMAGE_ID, 'sesSdk': SDK_VERSION,
    })

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed before the database migration')
    if inspect(APP)['Id'] != app['Id'] or support_ids() != support:
        raise RuntimeError('A service changed before the database migration')
    before_schema = database_state(migration_checksum)
    migration_state = validate_preflight(app, worker, db, meta, before_schema, migration_checksum)
    if migration_state == 'already_applied':
        migration_result = {
            'applied': {'applied': [], 'skipped': [MIGRATION_NAME]},
            'migration': before_schema['migration'],
        }
        after_migration = before_schema
    else:
        migration_result = apply_migration(migration_source, MIGRATION)
        after_migration = database_state(migration_checksum)
    applied = migration_result.get('migration') or {}
    if (applied.get('status') != 'applied' or applied.get('checksum') != migration_checksum
            or int(applied.get('statement_count') or 0) != int(applied.get('statements_completed') or -1)
            or after_migration.get('historyIncomplete')):
        raise RuntimeError('Email migration did not complete cleanly')
    write_private(backup / 'migration-applied.json', migration_result)

    try:
        compose_up(meta, env, [overlay])
        result = verify_runtime(contents, overlay, image_tag, migration_checksum,
                                candidate_node_path, before_schema, support)
        result.update({
            'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
            'baseRelease': BASE, 'baseImage': EXPECTED_IMAGE,
            'candidateImageId': image_id, 'appOverlay': str(overlay),
            'migrationResult': migration_result,
        })
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception as error:
        write_private(backup / 'deployment-failure.txt',
                      f'{type(error).__name__}: {error}\n')
        try:
            compose_up(meta, env)
            restored = wait_app()
            if restored['Config']['Image'] != EXPECTED_IMAGE or support_ids() != support:
                raise RuntimeError('Automatic app rollback did not restore the baseline')
            for name, expected in PREIMAGES.items():
                if container_hash(name) != expected:
                    raise RuntimeError('Automatic rollback file hash mismatch')
            write_private(backup / 'automatic-rollback.json', {
                'appHealth': restored['State'].get('Health', {}).get('Status'),
                'appImage': restored['Config']['Image'],
                'migrationRetained': migration_checksum,
                'supportServicesUnchanged': True,
            })
        except Exception as rollback_error:
            write_private(backup / 'automatic-rollback-failure.txt',
                          f'{type(rollback_error).__name__}: {rollback_error}\n')
        raise


def restore(backup):
    require_lock()
    backup = Path(backup)
    release_info = json.loads((backup / 'release.json').read_text())
    if release_info.get('baseRelease') != BASE:
        raise RuntimeError('Rollback base release differs')
    release = Path(release_info['release'])
    overlay = Path(release_info['overlay'])
    current = inspect(APP)
    files = current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    if not files or files[-1] != str(overlay):
        raise RuntimeError('A later app overlay is active; roll it back first')
    before = json.loads((backup / 'app-before.json').read_text())
    meta = before['compose']
    input_hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Rollback Compose inputs changed')
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('A support service changed; refusing rollback')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    env, _ = compose_environment(before['inspect'], meta)
    compose_up(meta, env)
    restored = wait_app()
    if restored['Config']['Image'] != before['image'] or restored['Image'] != before['imageId']:
        raise RuntimeError('Rollback image mismatch')
    for name, expected in PREIMAGES.items():
        if container_hash(name) != expected:
            raise RuntimeError('Rollback file hash mismatch')
    if support_ids() != support:
        raise RuntimeError('Rollback changed an unrelated service')
    migration = database_state().get('migration') or {}
    if (migration.get('status') != 'applied'
            or migration.get('checksum') != release_info['migrationChecksum']):
        raise RuntimeError('Rollback did not preserve the additive email migration')
    result = {
        'rolledBack': str(release), 'appHealth': restored['State'].get('Health', {}).get('Status'),
        'appImage': restored['Config']['Image'], 'supportServicesUnchanged': True,
        'emailMigrationRetained': migration,
    }
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
            deploy(Path(sys.argv[2]), sys.argv[3])
        elif len(sys.argv) == 3 and sys.argv[1] == 'recover-failed-email-migration':
            recover_failed_email_migration(Path(sys.argv[2]))
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(Path(sys.argv[2]))
        else:
            raise RuntimeError('Usage: deploy <stage> <commit> | recover-failed-email-migration <rollback-directory> | restore <rollback-directory>')
    except Exception as error:
        message = str(error)
        frame = error.__traceback__
        while frame and frame.tb_next:
            frame = frame.tb_next
        location = (f'{frame.tb_frame.f_code.co_name}:{frame.tb_lineno}'
                    if frame else 'unknown')
        detail = (message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message)
                  else 'EMAIL_MARKETING_RELEASE_FAILED')
        print(f'{detail} [{type(error).__name__} at {location}]', file=sys.stderr)
        sys.exit(1)
