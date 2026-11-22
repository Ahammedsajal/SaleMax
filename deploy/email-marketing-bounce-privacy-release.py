#!/usr/bin/env python3
"""Guarded, app-only, forward-fix-only release for Email Marketing bounce privacy."""
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
from datetime import datetime, timezone
from urllib.request import urlopen

ROOT = Path('/opt/salemax')
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
APP = 'salemax-app-1'
DB = 'salemax-db-1'
IMAGE_ID = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
IMAGE = 'salemax-app:email-marketing-21a07cc41fa9-20261112'
VERSION = '20261122-email-bounce-privacy1'
MIGRATION = 'database/migrations/20270209_email_bounce_privacy.sql'
RUNTIME_FILES = (
    'modules/platform/email-marketing.js',
    'modules/platform/email-marketing-events.js',
    'modules/platform/email-marketing-router.js',
    'modules/platform/email-marketing-worker.js',
    'modules/platform/email-marketing-inbox.js',
    'modules/platform/email-marketing-bounce-privacy.js',
    'modules/platform/phonebook-workspace.js',
    'modules/platform/phonebook-workspace-router.js',
    'modules/platform/mount-existing-upgrade.js',
    'client/public/email-marketing-workspace.css',
    'client/public/email-marketing-workspace.js',
    'client/public/index.html',
    MIGRATION,
)
HELPER = 'deploy/email-marketing-bounce-privacy-release.py'
SOURCE_FILES = (*RUNTIME_FILES, HELPER)
PREIMAGE_SHA256 = {
    'modules/platform/email-marketing.js': '9825cc4a31dd3cc32875d983d87600b43833e51154b4c3354ecc3df25355b9fc',
    'modules/platform/email-marketing-events.js': '7ef3474b91e6cd0f34684b44f01e4decda1c957b5b4cce3b35318359756fced9',
    'modules/platform/email-marketing-router.js': 'a08eab60ea28fae9027d3cd1a4120d7b2a3c9583260039e7c9c8b9a90de714fc',
    'modules/platform/email-marketing-worker.js': '7399cf77676db087fa2b8030a8f2ce0a1a373bc79c801fba8c06b4da26c1e245',
    'modules/platform/email-marketing-inbox.js': '57ac7c9b10e4e6ddf4069ab430cf21864233591c6a15d437a8367e8a6bfae12b',
    'modules/platform/phonebook-workspace.js': '9961fabedb722cec746635224ff8ab9e1964fd5ce0fdaac2913a5c5205a94672',
    'modules/platform/phonebook-workspace-router.js': '2afca15ea1e0afd0c15484ee39eb53f7f176d364819d06ef8aaae3cb90dab11c',
    'modules/platform/mount-existing-upgrade.js': '23da5db48cef1c315c8059a40a934b3e723686ac0530ad549a33e1352bd8e4ba',
    'client/public/email-marketing-workspace.js': '3985798c6f9ed7da1b0f452d9af0d4a77b9bb8a0c40b502a647693a0757829f1',
    'client/public/email-marketing-workspace.css': '1336092ccaddf487460bb24745173fd1971276ef02a1dfc6cefb2d74e91345b9',
    'client/public/index.html': 'eef14a309dda62ba23877e6c62f4b96d4164ee5af7335d0cf20f7982ce99d368',
}
PREVIOUS_RELEASE_COMMIT = '488d738bd7a02007c7231807845b8c49f89d10cb'
PREVIOUS_RUNTIME_SHA256 = {
    'modules/platform/email-marketing.js': 'e2057f05e1a20ba39b1168752ffb99e3e50a61c1338b1ad6556107935bd73b24',
    'modules/platform/email-marketing-events.js': '88647a435cc5e86b9bf3b618811baac57b1c1bbb44b805c49f019def60212140',
    'modules/platform/email-marketing-router.js': '52c1b518a0496dac2caae39fa8d5803cde6a75fb8726e77b5825849cc604ddbb',
    'modules/platform/email-marketing-worker.js': 'a697ff8cf7c675c631d716dc0368b85bfae58a5de27f85e15fc96420388209a7',
    'modules/platform/email-marketing-inbox.js': 'c64ba55bcc10785ce4188d4e0b273748e771fb7fc5dd998c43e9b93e7f3905ef',
    'modules/platform/email-marketing-bounce-privacy.js': '414e0038aef8a63d6d806b9d57f8ffdf15a6906d9c46044c8d716fc9a10facbc',
    'modules/platform/phonebook-workspace.js': '81e5dcefc4d6bcf26f47a728764abb4bc0ede7f236c8b02c24238d9c436fd095',
    'modules/platform/phonebook-workspace-router.js': '3d9a1b2c1eb09d7ecc1d114f5b2c3f51132f073679fe463588ad181af0279d16',
    'modules/platform/mount-existing-upgrade.js': 'd9eaaf6f98f7e91bac065d43540d519f2b4dd48643ddd05b0c738c11afb54e27',
    'client/public/email-marketing-workspace.css': '1336092ccaddf487460bb24745173fd1971276ef02a1dfc6cefb2d74e91345b9',
    'client/public/email-marketing-workspace.js': '8d0e2760a6b0ad31f908f5908aba3e841695c7ddf05d5f8c1f059fdae96dd326',
    'client/public/index.html': '40e4769e6db964913202b9b9cd6bacad7ead84089641d856fe1265bf81caaa0b',
    'database/migrations/20270209_email_bounce_privacy.sql': 'aa36341fed23a59ca8e4c9d2b17f1b0bf22167b13e1dbd334bdc346f5cd1d84b',
}
MINIMUM_FREE_BYTES = 4 * 1024**3


def run(*args, env=None, input_text=None, timeout=600):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True,
                            text=True, timeout=timeout)
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


def inventory():
    names = run('docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=salemax',
                '--format', '{{.Names}}').splitlines()
    return {name: inspect(name)['Id'] for name in names}


def compose_context(app):
    labels = app.get('Config', {}).get('Labels') or {}
    if (labels.get('com.docker.compose.project') != 'salemax' or
            labels.get('com.docker.compose.service') != 'app'):
        raise RuntimeError('Unexpected production app identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if (not files or not env_files or not workdir or
            not all(Path(path).is_file() for path in files + env_files)):
        raise RuntimeError('Active Compose inputs are incomplete')
    return files, env_files, workdir


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for path in env_files:
        args += ['--env-file', path]
    for path in files:
        args += ['-f', path]
    return args


def compose_environment(app, files, env_files):
    referenced, supplied = set(), set()
    for name in files:
        referenced.update(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text()))
    for name in env_files:
        supplied.update(re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M))
    live = dict(item.split('=', 1) for item in app['Config'].get('Env', []) if '=' in item)
    manual_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(manual_path.read_text()) if manual_path.is_file() else {}
    values = {}
    for key in referenced - supplied:
        if key in manual:
            values[key] = manual[key]
        elif key in live:
            values[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation input')
    env = dict(os.environ)
    for key in referenced:
        env.pop(key, None)
    env.update(values)
    return env, values


def verify_live_compose_app(app, config):
    service = config.get('services', {}).get('app') or {}
    if service.get('image') != app.get('Config', {}).get('Image'):
        raise RuntimeError('Resolved Compose image differs from running app')
    expected = {row['target']: row for row in service.get('volumes', []) if row.get('type') == 'bind'}
    actual = {row['Destination']: row for row in app.get('Mounts', []) if row.get('Type') == 'bind'}
    if set(expected) != set(actual):
        raise RuntimeError('Resolved Compose bind mounts differ from running app')
    for target, volume in expected.items():
        live = actual[target]
        if (os.path.realpath(volume.get('source', '')) != os.path.realpath(live.get('Source', '')) or
                bool(volume.get('read_only', False)) != (not bool(live.get('RW', True)))):
            raise RuntimeError('Resolved Compose bind mount differs from running app')


def validate_candidate(before, after, mounts):
    expected = {row['target']: row for row in before['services']['app'].get('volumes', [])}
    actual = {row['target']: row for row in after['services']['app'].get('volumes', [])}
    for mount in mounts:
        target = mount['target']
        row = actual.pop(target, {})
        expected.pop(target, None)
        if any(row.get(key) != mount.get(key) for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate is missing a reviewed read-only bind')
    if actual != expected:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app = copy.deepcopy(before['services']['app'])
    after_app = copy.deepcopy(after['services']['app'])
    before_app.pop('volumes', None)
    after_app.pop('volumes', None)
    if before_app != after_app:
        raise RuntimeError('Candidate changes app configuration beyond file mounts')
    if {key: value for key, value in before['services'].items() if key != 'app'} != {
            key: value for key, value in after['services'].items() if key != 'app'}:
        raise RuntimeError('Candidate changes another service')


def wait_healthy():
    for _ in range(60):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('App did not return to healthy state')


def container_has(path):
    result = subprocess.run(['docker', 'exec', APP, 'test', '-e', '/app/' + path],
                            capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise RuntimeError('Container path probe failed')
    return result.returncode == 0


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active production base release changed')


def stage(source_root, stage_path, commit):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    source_root = Path(source_root).resolve()
    stage_path = Path(stage_path).expanduser().absolute()
    if (stage_path.exists() or stage_path.is_symlink() or stage_path == source_root or
            source_root in stage_path.parents):
        raise RuntimeError('Stage path exists or is inside the source checkout')
    if run('git', '-C', str(source_root), 'rev-parse', 'HEAD').strip() != commit:
        raise RuntimeError('Checkout does not match requested source commit')
    stage_path.mkdir(mode=0o700, parents=True)
    files = {}
    try:
        for name in SOURCE_FILES:
            source = source_root / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('Reviewed source file is missing or is a symlink')
            data = subprocess.check_output(['git', '-C', str(source_root), 'show', f'{commit}:{name}'])
            if source.read_bytes() != data:
                raise RuntimeError('File differs from committed source: ' + name)
            target = stage_path / 'source' / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
            files[name] = sha(data)
        (stage_path / 'manifest.json').write_text(json.dumps({'sourceCommit': commit, 'files': files}, indent=2) + '\n')
        (stage_path / 'manifest.json').chmod(0o600)
    except Exception:
        shutil.rmtree(stage_path, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(stage_path), 'sourceCommit': commit, 'files': files}))


def validate_stage(stage_path, commit):
    stage_path = Path(stage_path).resolve()
    manifest_path = stage_path / 'manifest.json'
    if stage_path.is_symlink() or not stage_path.is_dir() or manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError('Stage or manifest is missing or invalid')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != set(SOURCE_FILES):
        raise RuntimeError('Stage manifest differs from reviewed source')
    for name, digest in manifest['files'].items():
        path = stage_path / 'source' / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Staged source hash mismatch')
    return stage_path, manifest


def public_check(expected_hashes):
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public health endpoint did not return HTTP 200')
    with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public Email Marketing workspace did not return HTTP 200')
        shell = response.read().decode('utf-8', errors='replace')
    public_assets = {}
    for asset in ('client/public/email-marketing-workspace.css',
                  'client/public/email-marketing-workspace.js'):
        url = '/' + Path(asset).name + '?v=' + VERSION
        if url not in shell:
            raise RuntimeError('Email Marketing shell lacks cache-versioned asset')
        with urlopen('https://7network.live' + url, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError('Public asset did not return HTTP 200')
            digest = sha(response.read())
        if digest != expected_hashes[asset]:
            raise RuntimeError('Public asset hash mismatch: ' + Path(asset).name)
        public_assets[Path(asset).name] = digest
    return {'healthz': 'HTTP 200', 'workspace': 'HTTP 200', 'assets': public_assets}


def apply_migration(filename, sql, staged_migrations):
    script = r"""
let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>body+=x);process.stdin.on('end',async()=>{let c;try{
 const input=JSON.parse(body),runner=require('/app/database/migration-runner'),crypto=require('node:crypto'),mysql=require('mysql2/promise');
 const migrations=runner.discover('/app/database/migrations');
 for(const [filename,sql] of Object.entries(input.migrations)){const checksum=crypto.createHash('sha256').update(sql,'utf8').digest('hex'),found=migrations.find(m=>m.file===filename);if(found&&found.checksum!==checksum)throw Object.assign(Error(),{code:'MIGRATION_CHECKSUM_CHANGED'});if(!found)migrations.push({file:filename,checksum,statements:runner.splitSql(sql)});}
 if(!input.migrations[input.filename])throw Object.assign(Error(),{code:'MIGRATION_NOT_FOUND'});
 migrations.sort((a,b)=>a.file.localeCompare(b.file));
 c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,multipleStatements:false});
 const applied=await runner.applyMigrations(c,migrations,{only:input.filename});
 const [rows]=await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[input.filename]);
 console.log(JSON.stringify({applied,migration:rows[0]||null}));
}catch(e){console.log(JSON.stringify({migrationError:e.code||e.name||'MIGRATION_FAILED'}));process.exitCode=1}finally{try{await c?.end()}catch{}}});
"""
    result = run('docker', 'exec', '-i', APP, 'node', '-e', script,
                 input_text=json.dumps({'filename': filename, 'migrations': staged_migrations}), timeout=900)
    parsed = json.loads(result.splitlines()[-1])
    if parsed.get('migrationError'):
        raise RuntimeError(str(parsed['migrationError']))
    row = parsed.get('migration') or {}
    if row.get('status') != 'applied' or int(row.get('statement_count', 0)) != int(row.get('statements_completed', -1)):
        raise RuntimeError('Migration did not finish all statements')
    return row


def schema_state():
    script = r"""
const mysql=require('mysql2/promise');
(async()=>{const c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
try{
const [[{tables}]]=await c.query("SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='sx_email_bounce_suppressions'");
const [[{columns}]]=await c.query("SELECT COUNT(*) AS columns FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='sx_email_campaign_recipients' AND column_name='email_fingerprint') OR (table_name='sx_email_messages' AND column_name='last_error_code'))");
const [ledger]=await c.query("SELECT migration_name,status,checksum,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?",['20270209_email_bounce_privacy.sql']);
console.log(JSON.stringify({tables,columns,ledger}));
}finally{await c.end();}})().catch(e=>{console.error(e.code||'schema-check-failed');process.exitCode=1;});
"""
    return json.loads(run('docker','exec',APP,'node','-e',script).splitlines()[-1])


def pre_scrub_counts():
    script = r"""
const mysql=require('mysql2/promise');
(async()=>{const c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
try{
const [[{legacyBounceRows}]]=await c.query("SELECT COUNT(*) AS legacyBounceRows FROM sx_email_suppressions WHERE reason='bounce'");
const [[{contactEmailCopies}]]=await c.query(`SELECT COUNT(*) AS contactEmailCopies FROM contact c JOIN user u ON u.uid=c.uid
 JOIN sx_legacy_ownership o ON o.source_table='user' AND o.tenant_id IS NOT NULL AND BINARY CAST(u.id AS CHAR)=BINARY o.source_id AND BINARY SHA2(u.uid,256)=BINARY o.legacy_uid_hash
 JOIN sx_email_suppressions s ON s.tenant_id=o.tenant_id AND s.reason='bounce' AND LOWER(TRIM(COALESCE(c.email,'')))=s.normalized_email`);
const [[{recipientEmailCopies}]]=await c.query(`SELECT COUNT(*) AS recipientEmailCopies FROM sx_email_campaign_recipients r
 JOIN sx_email_suppressions s ON s.tenant_id=r.tenant_id AND s.reason='bounce' AND r.normalized_email=s.normalized_email`);
const [[{threadEmailCopies}]]=await c.query(`SELECT COUNT(*) AS threadEmailCopies FROM sx_email_threads t
 JOIN sx_email_suppressions s ON s.tenant_id=t.tenant_id AND s.reason='bounce' AND LOWER(TRIM(COALESCE(t.recipient_email,'')))=s.normalized_email`);
console.log(JSON.stringify({legacyBounceRows,contactEmailCopies,recipientEmailCopies,threadEmailCopies}));
}finally{await c.end();}})().catch(e=>{console.error(e.code||'bounce-preflight-audit-failed');process.exitCode=1;});
"""
    return json.loads(run('docker','exec',APP,'node','-e',script).splitlines()[-1])


def cleanup_legacy_bounces():
    script = r"""
const pool=require('/app/database/config').promise();
const encoded=process.env.SALEMAX_PLATFORM_KEY_BASE64||'';
const key=Buffer.from(encoded,'base64');
(async()=>{try{if(key.length!==32||key.toString('base64')!==encoded)throw Object.assign(Error(),{code:'EMAIL_SUPPRESSION_KEY_UNAVAILABLE'});
const result=await require('/app/modules/platform/email-marketing-bounce-privacy').migrateLegacyBounces(pool,key);
console.log(JSON.stringify(result));
}finally{await pool.end();}})().catch(e=>{console.error(e.code||'bounce-cleanup-failed');process.exitCode=1;});
"""
    output = run('docker','exec',APP,'node','-e',script,timeout=900)
    for line in reversed(output.splitlines()):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise RuntimeError('Bounce cleanup returned no summary')


def privacy_audit():
    script = r"""
const mysql=require('mysql2/promise'),privacy=require('/app/modules/platform/email-marketing-bounce-privacy');
const encoded=process.env.SALEMAX_PLATFORM_KEY_BASE64||'',key=Buffer.from(encoded,'base64');
(async()=>{const c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
try{if(key.length!==32||key.toString('base64')!==encoded)throw Object.assign(Error(),{code:'EMAIL_SUPPRESSION_KEY_UNAVAILABLE'});
const [[{legacyBounceRows}]]=await c.query("SELECT COUNT(*) AS legacyBounceRows FROM sx_email_suppressions WHERE reason='bounce'");
const [[{fingerprintSuppressions}]]=await c.query('SELECT COUNT(*) AS fingerprintSuppressions FROM sx_email_bounce_suppressions');
const [[{recipientEmailCopies}]]=await c.query(`SELECT COUNT(*) AS recipientEmailCopies FROM sx_email_campaign_recipients r
 JOIN sx_email_bounce_suppressions s ON s.tenant_id=r.tenant_id AND s.email_fingerprint=r.email_fingerprint
 WHERE (COALESCE(r.recipient_email,'')<>'' OR (COALESCE(r.normalized_email,'')<>'' AND r.normalized_email NOT LIKE '!bounced:%'))`);
const [[{threadEmailCopies}]]=await c.query(`SELECT COUNT(*) AS threadEmailCopies FROM sx_email_threads t
 JOIN sx_email_campaign_recipients r ON r.tenant_id=t.tenant_id AND r.campaign_id=t.campaign_id AND r.id=t.recipient_id
 JOIN sx_email_bounce_suppressions s ON s.tenant_id=r.tenant_id AND s.email_fingerprint=r.email_fingerprint
 WHERE COALESCE(t.recipient_email,'')<>''`);
const [suppressed]=await c.query('SELECT tenant_id AS tenantId,email_fingerprint AS fingerprint FROM sx_email_bounce_suppressions');
const byTenant=new Map();for(const row of suppressed){if(!byTenant.has(row.tenantId))byTenant.set(row.tenantId,new Set());byTenant.get(row.tenantId).add(row.fingerprint);}
let contactEmailCopies=0;
for(const [tenantId,fingerprints] of byTenant){
 const [contacts]=await c.query(`SELECT c.email FROM contact c JOIN user u ON u.uid=c.uid
  JOIN sx_legacy_ownership o ON o.source_table='user' AND o.tenant_id=? AND BINARY CAST(u.id AS CHAR)=BINARY o.source_id AND BINARY SHA2(u.uid,256)=BINARY o.legacy_uid_hash
   WHERE COALESCE(c.email,'')<>''`,[tenantId]);
 for(const row of contacts)if(fingerprints.has(privacy.emailFingerprint(key,tenantId,row.email)))contactEmailCopies++;
}
console.log(JSON.stringify({legacyBounceRows,fingerprintSuppressions,recipientEmailCopies,threadEmailCopies,contactEmailCopies}));
}finally{await c.end();}})().catch(e=>{console.error(e.code||'bounce-postflight-audit-failed');process.exitCode=1;});
"""
    return json.loads(run('docker','exec',APP,'node','-e',script,timeout=900).splitlines()[-1])

def deploy(stage_path, commit):
    require_lock()
    stage_path, manifest = validate_stage(stage_path, commit)
    app, db = inspect(APP), inspect(DB)
    if (app['State'].get('Health', {}).get('Status') != 'healthy' or
            app['Image'] != IMAGE_ID or app['Config'].get('Image') != IMAGE):
        raise RuntimeError('Active app health or image differs from reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize < MINIMUM_FREE_BYTES:
        raise RuntimeError('Insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env, variables = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during preflight')
    prior_schema = schema_state()
    if prior_schema != {'tables': 0, 'columns': 0, 'ledger': []}:
        raise RuntimeError('Bounce privacy schema differs from reviewed preimage')
    before_bounce_counts = pre_scrub_counts()
    for name in RUNTIME_FILES:
        if name not in PREIMAGE_SHA256 and container_has(name):
            raise RuntimeError('New runtime path already exists: ' + name)
    prior = {}
    for name, expected in PREIMAGE_SHA256.items():
        data = run('docker', 'exec', APP, 'cat', '/app/' + name).encode()
        if sha(data) != expected:
            raise RuntimeError('Live runtime differs from reviewed preimage: ' + name)
        prior[name] = data
    changed = {name: (stage_path / 'source' / name).read_bytes() for name in RUNTIME_FILES}
    hashes = {name: sha(data) for name, data in changed.items()}
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    verify_live_compose_app(app, before)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-bounce-privacy-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'forward-fix-email-bounce-privacy-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or deployment snapshot path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    for name, data in prior.items():
        saved = preimages / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        saved.write_bytes(data)
        saved.chmod(0o600)
    for name, data in changed.items():
        target = runtime / name
        target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-bounce-privacy.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': IMAGE, 'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_copy = release / HELPER
    helper_copy.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_copy.write_bytes((stage_path / 'source' / HELPER).read_bytes())
    helper_copy.chmod(0o644)
    for name, value in {
        'app-before.json': json.dumps({'id': app['Id'], 'image': app['Config']['Image'], 'imageId': app['Image']}, indent=2) + '\n',
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'compose-vars.json': json.dumps(variables),
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'database-before.json': json.dumps({'schema': prior_schema, 'bounceCounts': before_bounce_counts}, indent=2) + '\n',
        'migration-hash.txt': hashes[MIGRATION] + '\n',
        'preimage-hashes.json': json.dumps(PREIMAGE_SHA256, indent=2) + '\n',
        'support-services.json': json.dumps({n: i for n, i in before_inventory.items() if n != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
        'rollback-policy.txt': 'Forward-fix only after bounce-address scrubbing. Previous app versions do not read HMAC suppression rows. Do not restore pre-scrub application code.\n',
    }.items():
        write_private(backup / name, value)
    candidate = common + ['-f', str(overlay)]
    after = json.loads(run(*(candidate + ['config', '--format', 'json']), env=env))
    validate_candidate(before, after, mounts)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during release preparation')
    if inventory() != before_inventory or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Production container inventory changed during release preparation')
    sql = changed[MIGRATION].decode()
    filename = Path(MIGRATION).name
    migration = apply_migration(filename, sql, {filename: sql})
    write_private(backup / 'migration.json', migration)
    run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
        env=env, timeout=900)
    current = wait_healthy()
    if current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files + [str(overlay)]):
        raise RuntimeError('Unexpected active Compose chain')
    if current['Image'] != app['Image'] or current['Config']['Image'] != app['Config']['Image']:
        raise RuntimeError('App image changed unexpectedly')
    after_inventory = inventory()
    if {n: i for n, i in after_inventory.items() if n != APP} != {
            n: i for n, i in before_inventory.items() if n != APP}:
        raise RuntimeError('A non-app production container changed')
    for name, digest in hashes.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
            raise RuntimeError('Runtime file hash mismatch: ' + name)
    run('docker', 'exec', APP, 'node', '-e',
        "require('/app/modules/platform/email-marketing-worker');require('/app/modules/platform/email-marketing-inbox');require('/app/modules/platform/email-marketing-bounce-privacy');require('/app/modules/platform/phonebook-workspace');require('/app/modules/platform/phonebook-workspace-router');console.log('email-modules-loaded')")
    if inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database did not remain healthy')
    schema = schema_state()
    if (schema['tables'] != 1 or schema['columns'] != 2 or len(schema['ledger']) != 1 or
            schema['ledger'][0]['status'] != 'applied' or
            schema['ledger'][0]['checksum'] != hashes[MIGRATION] or
            int(schema['ledger'][0]['statement_count']) != int(schema['ledger'][0]['statements_completed']) or
            migration['checksum'] != hashes[MIGRATION]):
        raise RuntimeError('Bounce privacy schema validation failed')
    cleanup = cleanup_legacy_bounces()
    audit = privacy_audit()
    if (audit['legacyBounceRows'] != 0 or audit['recipientEmailCopies'] != 0 or
            audit['threadEmailCopies'] != 0 or audit['contactEmailCopies'] != 0 or
            audit['fingerprintSuppressions'] < before_bounce_counts['legacyBounceRows']):
        raise RuntimeError('Bounced email privacy audit found remaining cleartext')
    public = public_check(hashes)
    result = {'sourceCommit': commit, 'release': str(release), 'deploymentSnapshot': str(backup),
              'rollbackPolicy': 'forward-fix-only-after-data-scrub',
              'image': current['Image'], 'imageReference': current['Config']['Image'],
              'composeInputs': len(files) + 1, 'environmentInputs': len(env_files),
              'appMounts': len(current['Mounts']), 'runtimeHashes': hashes,
              'preimageHashes': PREIMAGE_SHA256, 'nonAppContainersUnchanged': len(after_inventory) - 1,
              'appHealthy': True, 'databaseHealthy': True, 'databaseChanged': True,
              'migration': migration, 'legacyBounceCountsBefore': before_bounce_counts,
              'cleanupSummary': cleanup, 'postCleanupCounts': audit,
              'emailWorkerLoad': 'passed', 'publicChecks': public, 'emailSent': False}
    write_private(backup / 'result.json', result)
    print(json.dumps(result))

def repair(stage_path, commit):
    """Replace a failed first bounce-privacy overlay without reverting its schema."""
    require_lock()
    stage_path, manifest = validate_stage(stage_path, commit)
    app, db = inspect(APP), inspect(DB)
    if app['State'].get('Status') not in ('running', 'restarting'):
        raise RuntimeError('Recovery requires the identified running or restarting app container')
    if app['Image'] != IMAGE_ID or app['Config'].get('Image') != IMAGE:
        raise RuntimeError('Active app image differs from reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize < MINIMUM_FREE_BYTES:
        raise RuntimeError('Insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    old_overlay = Path(files[-1])
    if (old_overlay.name != 'compose.email-marketing-bounce-privacy.json' or
            old_overlay.parent.name != f'email-marketing-bounce-privacy-{PREVIOUS_RELEASE_COMMIT[:12]}-20261122T091925Z'):
        raise RuntimeError('Active Compose tail is not the failed reviewed bounce-privacy release')
    old_release = old_overlay.parent
    old_backup = ROOT / 'shared' / f'forward-fix-email-bounce-privacy-{PREVIOUS_RELEASE_COMMIT[:12]}-20261122T091925Z'
    if not old_backup.is_dir():
        raise RuntimeError('Prior forward-fix snapshot is missing')
    migration_record = json.loads((old_backup / 'migration.json').read_text())
    prior_database = json.loads((old_backup / 'database-before.json').read_text())
    before_bounce_counts = prior_database.get('bounceCounts') or {}
    if (migration_record.get('migration_name') != Path(MIGRATION).name or
            migration_record.get('status') != 'applied' or
            migration_record.get('checksum') != PREVIOUS_RUNTIME_SHA256['database/migrations/20270209_email_bounce_privacy.sql']):
        raise RuntimeError('Applied bounce-privacy migration record differs from the reviewed release')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env, variables = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during recovery preflight')
    for name, expected in PREVIOUS_RUNTIME_SHA256.items():
        path = old_release / 'runtime' / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != expected:
            raise RuntimeError('Failed release runtime differs from reviewed state: ' + name)
    before = json.loads(run(*(compose_args(files, env_files, workdir) + ['config', '--format', 'json']), env=env))
    verify_live_compose_app(app, before)
    live_mounts = {row['Destination']: row for row in app.get('Mounts', []) if row.get('Type') == 'bind'}
    for name in PREVIOUS_RUNTIME_SHA256:
        target = '/app/' + name
        expected_source = os.path.realpath(old_release / 'runtime' / name)
        if target not in live_mounts or os.path.realpath(live_mounts[target].get('Source', '')) != expected_source:
            raise RuntimeError('Failed release mount differs from reviewed state: ' + name)
    changed = {name: (stage_path / 'source' / name).read_bytes() for name in RUNTIME_FILES}
    hashes = {name: sha(data) for name, data in changed.items()}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-bounce-privacy-recovery-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'forward-fix-email-bounce-privacy-recovery-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Recovery release or snapshot path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    for name in RUNTIME_FILES:
        prior_path = old_release / 'runtime' / name
        if prior_path.is_file():
            saved = preimages / name
            saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            saved.write_bytes(prior_path.read_bytes())
            saved.chmod(0o600)
    for name, data in changed.items():
        target = runtime / name
        target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-bounce-privacy-recovery.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': IMAGE, 'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_copy = release / HELPER
    helper_copy.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_copy.write_bytes((stage_path / 'source' / HELPER).read_bytes())
    helper_copy.chmod(0o644)
    for name, value in {
        'app-before.json': json.dumps({'id': app['Id'], 'state': app['State']['Status'], 'restarts': app.get('RestartCount', 0), 'image': app['Config']['Image'], 'imageId': app['Image']}, indent=2) + '\n',
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'compose-vars.json': json.dumps(variables),
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'migration-reused.json': json.dumps(migration_record, indent=2) + '\n',
        'preimage-hashes.json': json.dumps(PREVIOUS_RUNTIME_SHA256, indent=2) + '\n',
        'support-services.json': json.dumps({n: i for n, i in before_inventory.items() if n != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
        'rollback-policy.txt': 'Forward-fix only. Bounce addresses have been scrubbed or are being scrubbed. Previous app versions do not enforce the HMAC suppression table.\n',
    }.items():
        write_private(backup / name, value)
    candidate = compose_args(files, env_files, workdir) + ['-f', str(overlay)]
    after = json.loads(run(*(candidate + ['config', '--format', 'json']), env=env))
    validate_candidate(before, after, mounts)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during recovery preparation')
    if inventory() != before_inventory or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Production container inventory changed during recovery preparation')
    run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=900)
    current = wait_healthy()
    if current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files + [str(overlay)]):
        raise RuntimeError('Unexpected active Compose chain after recovery')
    if current['Image'] != app['Image'] or current['Config']['Image'] != app['Config']['Image']:
        raise RuntimeError('App image changed unexpectedly during recovery')
    after_inventory = inventory()
    if {n: i for n, i in after_inventory.items() if n != APP} != {n: i for n, i in before_inventory.items() if n != APP}:
        raise RuntimeError('A non-app production container changed during recovery')
    for name, digest in hashes.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
            raise RuntimeError('Recovery runtime file hash mismatch: ' + name)
    run('docker', 'exec', APP, 'node', '-e',
        "require('/app/modules/platform/email-marketing-worker');require('/app/modules/platform/email-marketing-inbox');require('/app/modules/platform/email-marketing-bounce-privacy');require('/app/modules/platform/phonebook-workspace');console.log('email-modules-loaded')")
    if inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database did not remain healthy')
    schema = schema_state()
    if (schema['tables'] != 1 or schema['columns'] != 2 or len(schema['ledger']) != 1 or
            schema['ledger'][0]['status'] != 'applied' or
            schema['ledger'][0]['checksum'] != PREVIOUS_RUNTIME_SHA256['database/migrations/20270209_email_bounce_privacy.sql']):
        raise RuntimeError('Applied bounce-privacy schema validation failed during recovery')
    cleanup = cleanup_legacy_bounces()
    audit = privacy_audit()
    if (audit['legacyBounceRows'] != 0 or audit['recipientEmailCopies'] != 0 or
            audit['threadEmailCopies'] != 0 or audit['contactEmailCopies'] != 0 or
            audit['fingerprintSuppressions'] < int(before_bounce_counts.get('legacyBounceRows', 0))):
        raise RuntimeError('Bounce privacy audit found remaining cleartext after recovery')
    public = public_check(hashes)
    result = {'sourceCommit': commit, 'release': str(release), 'deploymentSnapshot': str(backup),
              'recoveryOf': str(old_overlay), 'rollbackPolicy': 'forward-fix-only-after-data-scrub',
              'image': current['Image'], 'imageReference': current['Config']['Image'],
              'composeInputs': len(files) + 1, 'environmentInputs': len(env_files),
              'appMounts': len(current['Mounts']), 'runtimeHashes': hashes,
              'priorRuntimeHashes': PREVIOUS_RUNTIME_SHA256,
              'nonAppContainersUnchanged': len(after_inventory) - 1,
              'appHealthy': True, 'databaseHealthy': True, 'migrationReused': migration_record,
              'legacyBounceCountsBefore': before_bounce_counts,
              'cleanupSummary': cleanup, 'postCleanupCounts': audit,
              'emailWorkerLoad': 'passed', 'publicChecks': public, 'emailSent': False}
    write_private(backup / 'result.json', result)
    print(json.dumps(result))


def restore(backup_path):
    require_lock()
    backup = Path(backup_path).resolve()
    try:
        backup.relative_to(ROOT / 'shared')
    except ValueError:
        raise RuntimeError('Deployment snapshot is outside protected shared storage')
    if not backup.is_dir() or not (backup / 'rollback-policy.txt').is_file():
        raise RuntimeError('Deployment snapshot is missing')
    raise RuntimeError('Unsafe rollback refused: bounced addresses were scrubbed and the previous app does not enforce HMAC suppression. Apply a forward fix.')


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        deploy(args[1], args[2])
    elif len(args) == 3 and args[0] == 'repair':
        repair(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        restore(args[1])
    else:
        raise SystemExit('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | repair <stage> <commit> | restore <snapshot>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'error': f'{type(error).__name__}: {error}'}), file=sys.stderr)
        raise SystemExit(1)
