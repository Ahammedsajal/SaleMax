"""Deploy the Connected Stores runtime as a guarded, app-only overlay release."""
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request


APP = 'salemax-app-1'
HOST = 'carsqatar-prod-01'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
PRIOR = Path('/opt/salemax/shared/rollback-retail-commerce-b3a940b81d9a')
PRIOR_LAST_OVERLAY = '/opt/salemax/releases/retail-commerce-b3a940b81d9a/compose.retail-commerce.json'
MIGRATIONS = ('20270132_retail_connected_stores.sql',)
RETAIL_MIGRATIONS = tuple(f'202701{n:02d}_{suffix}.sql' for n, suffix in (
    (25, 'private_business_inventory'), (26, 'retail_commerce'), (27, 'retail_cash_and_returns'),
    (28, 'retail_delivery_retries_and_proof'), (29, 'retail_locations_and_variants'),
    (30, 'retail_notifications'), (31, 'retail_customer_notice_consent'),
    (32, 'retail_connected_stores')))
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1')
PRIOR_TABLES = {
    'sx_retail_store', 'sx_retail_listings', 'sx_retail_orders', 'sx_retail_stock_reservations',
    'sx_retail_cash_receipts', 'sx_retail_cash_settlements', 'sx_retail_cash_settlement_orders',
    'sx_retail_returns', 'sx_retail_return_lines', 'sx_retail_delivery_proofs',
    'sx_retail_delivery_attempts', 'sx_retail_locations', 'sx_retail_variant_groups',
    'sx_retail_variant_products', 'sx_retail_stock_transfers',
    'sx_retail_customer_notification_consents', 'sx_retail_customer_notification_consent_events',
}
NEW_TABLES = {
    'sx_retail_store_connections', 'sx_retail_store_oauth_states', 'sx_retail_external_customers',
    'sx_retail_external_products', 'sx_retail_store_privacy_requests', 'sx_retail_external_transactions',
    'sx_retail_external_events', 'sx_retail_external_orders', 'sx_retail_external_checkouts',
}


def run(*args, env=None, input_text=None):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hash_path(path):
    return digest(Path(path).read_bytes())


def http(path):
    try:
        with urllib.request.urlopen('https://7network.live' + path, timeout=15) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as response:
        return response.code, response.read(), response.headers


def parse_manifest(stage):
    rows = []
    for line in (stage / 'manifest.txt').read_text().splitlines():
        expected, relative = line.split(maxsplit=1)
        path = PurePosixPath(relative)
        if expected != 'new' and not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise RuntimeError('Invalid baseline hash in release manifest')
        if path.is_absolute() or '..' in path.parts or not path.parts:
            raise RuntimeError('Invalid path in release manifest')
        rows.append((expected, relative))
    if not rows or len({path for _, path in rows}) != len(rows):
        raise RuntimeError('Release manifest is empty or duplicated')
    return rows


def db_call(action, file=None, source=None):
    program = r"""
const fs=require('node:fs');
const crypto=require('node:crypto');
const mysql=require('/app/node_modules/mysql2/promise');
const runner=require('/app/database/migration-runner');
const migrations=['20270125_private_business_inventory.sql','20270126_retail_commerce.sql','20270127_retail_cash_and_returns.sql','20270128_retail_delivery_retries_and_proof.sql','20270129_retail_locations_and_variants.sql','20270130_retail_notifications.sql','20270131_retail_customer_notice_consent.sql','20270132_retail_connected_stores.sql'];
const newTables=['sx_retail_store_connections','sx_retail_store_oauth_states','sx_retail_external_customers','sx_retail_external_products','sx_retail_store_privacy_requests','sx_retail_external_transactions','sx_retail_external_events','sx_retail_external_orders','sx_retail_external_checkouts'];
(async()=>{
 const action=process.argv[1], connection=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
 try {
  if(action==='snapshot'||action==='verify'){
   const [ledger]=await connection.query(`SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name IN (${migrations.map(()=>'?').join(',')}) ORDER BY migration_name`,migrations);
   const [tableRows]=await connection.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'sx_retail_%' ORDER BY table_name");
   const [[stores]]=await connection.query('SELECT COUNT(*) AS count FROM sx_retail_store WHERE enabled=1');
   const [[plans]]=await connection.query("SELECT COUNT(*) AS count FROM sx_plan_versions WHERE JSON_CONTAINS(capabilities,JSON_QUOTE('retail.commerce'))");
   const [[assignments]]=await connection.query("SELECT COUNT(*) AS count FROM sx_plan_assignments a JOIN sx_plan_versions p ON p.id=a.plan_version_id WHERE a.status='active' AND (a.expires_at IS NULL OR a.expires_at>UTC_TIMESTAMP()) AND JSON_CONTAINS(p.capabilities,JSON_QUOTE('retail.commerce'))");
   const result={ledger,tables:tableRows.map(row=>row.table_name),enabledStores:Number(stores.count),entitledPlans:Number(plans.count),activeCommerceAssignments:Number(assignments.count)};
   if(action==='verify'){
    result.newTableRows={};
    for(const table of newTables){ const [[row]]=await connection.query('SELECT COUNT(*) AS count FROM `'+table+'`'); result.newTableRows[table]=Number(row.count); }
   }
   console.log(JSON.stringify(result));
  } else if(action==='apply'){
   const name=process.argv[2], sql=fs.readFileSync(0,'utf8'), discovered=runner.discover('/app/database/migrations');
   const checksum=crypto.createHash('sha256').update(sql).digest('hex'), statements=runner.splitSql(sql);
   const found=discovered.find(row=>row.file===name);
   if(found&&(found.checksum!==checksum||JSON.stringify(found.statements)!==JSON.stringify(statements))) throw new Error('MIGRATION_SOURCE_MISMATCH');
   if(!found) discovered.push({file:name,checksum,statements});
   console.log(JSON.stringify(await runner.applyMigrations(connection,discovered,{only:name})));
  } else throw new Error('INVALID_ACTION');
 } finally { await connection.end(); }
})().catch(error=>{console.error('Connected Stores database operation stopped:',/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'DB_OPERATION_FAILED');process.exitCode=1;});
"""
    args = ['docker', 'exec', '-i', APP, 'node', '-e', program, action]
    if file:
        args.append(file)
    result = subprocess.run(args, input=source, capture_output=True, text=True)
    if result.returncode:
        code = re.search(r'Connected Stores database operation stopped: ([A-Z0-9_]+)', result.stderr)
        raise RuntimeError('Connected Stores database operation failed: ' + (code[1] if code else 'details withheld'))
    return result.stdout


def wait_healthy():
    for _ in range(40):
        current = inspect(APP)
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(2)
    raise RuntimeError('Application did not return to healthy state')


def restore_helper(backup, base_files, env_files, workdir, overlay, new_chain, support, preimages, new_paths):
    source = f'''import json, os, re, subprocess, time
APP={APP!r}
BASE={BASE!r}
BACKUP={str(backup)!r}
FILES={base_files!r}
ENVS={env_files!r}
WORKDIR={workdir!r}
OVERLAY={str(overlay)!r}
NEW_CHAIN={new_chain!r}
SUPPORT={support!r}
PREIMAGES={preimages!r}
NEW_PATHS={new_paths!r}
assert os.environ.get("SALEMAX_DEPLOY_LOCK_HELD")=="1" and os.geteuid()==0, "protected production lock required"
assert subprocess.check_output(["hostname"],text=True).strip()=={HOST!r}
assert os.path.realpath("/opt/salemax/current")==BASE
def inspect(name): return json.loads(subprocess.check_output(["docker","inspect",name],text=True))[0]
app=inspect(APP)
assert app["Config"]["Labels"].get("com.docker.compose.project.config_files")==",".join(NEW_CHAIN), "newer application overlay is active"
manual=json.load(open(BACKUP+"/compose-manual-vars.json"))
live=dict(item.split("=",1) for item in app["Config"].get("Env",[]) if "=" in item)
env=dict(os.environ); env.update(manual)
provided=set()
for path in ENVS:
    for line in open(path):
        match=re.match(r"^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=",line)
        if match: provided.add(match.group(1))
referenced=set()
for path in FILES:
    referenced.update(re.findall(r"\\$\\{{([A-Za-z_][A-Za-z0-9_]*)",open(path).read()))
for key in referenced-provided:
    if key not in env:
        if key not in live: raise SystemExit("missing safe Compose interpolation input")
        env[key]=live[key]
common=["docker","compose","--project-name","salemax","--project-directory",WORKDIR]
for path in ENVS: common.extend(["--env-file",path])
for path in FILES: common.extend(["-f",path])
subprocess.run(common+["up","-d","--no-deps","--no-build","--force-recreate","app"],env=env,check=True,stdout=subprocess.DEVNULL)
for _ in range(40):
    app=inspect(APP)
    if app["State"].get("Health",{{}}).get("Status")=="healthy": break
    time.sleep(2)
else: raise SystemExit("previous app chain did not become healthy")
if app["Image"]!={IMAGE!r}: raise SystemExit("previous app image changed")
for name,identity in SUPPORT.items():
    if inspect(name)["Id"]!=identity: raise SystemExit("support service changed during rollback")
if app["Config"]["Labels"].get("com.docker.compose.project.config_files")!=",".join(FILES): raise SystemExit("previous Compose chain did not restore")
for relative,digest in PREIMAGES.items():
    actual=subprocess.check_output(["docker","exec",APP,"sha256sum","/app/"+relative],text=True).split()[0]
    if actual!=digest: raise SystemExit("prior file preimage did not restore")
for relative in NEW_PATHS:
    if subprocess.run(["docker","exec",APP,"test","!","-e","/app/"+relative]).returncode: raise SystemExit("new release file remains mounted")
before=json.load(open(BACKUP+"/app-before.json"))
mounts=lambda rows: sorted((row["Destination"],row["Source"],row.get("RW"),row.get("Type")) for row in rows)
if mounts(app["Mounts"])!=mounts(before["mounts"]): raise SystemExit("previous application mount map differs")
print(json.dumps({{"applicationRestored":True,"databaseMigrationKept":{MIGRATIONS!r},"supportServicesUnchanged":True}}))
'''
    path = backup / 'restore-app-under-lock.py'
    path.write_text(source)
    path.chmod(0o600)


def main(stage, commit):
    if os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1' or os.geteuid() != 0:
        raise RuntimeError('Protected production lock required')
    if subprocess.check_output(['hostname'], text=True).strip() != HOST or os.path.realpath('/opt/salemax/current') != BASE:
        raise RuntimeError('Production host or base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if (stage / 'source-commit.txt').read_text().strip() != commit:
        raise RuntimeError('Staged source commit does not match release argument')

    manifest = parse_manifest(stage)
    artifact_hashes = json.loads((stage / 'artifact-hashes.json').read_text())
    runtime_paths = {relative for _, relative in manifest}
    if set(artifact_hashes) != runtime_paths:
        raise RuntimeError('Artifact hashes differ from the reviewed runtime manifest')
    for _, relative in manifest:
        source = stage / relative
        if source.is_symlink() or not source.is_file() or hash_path(source) != artifact_hashes[relative]:
            raise RuntimeError('Staged runtime artifact failed its hash check')

    app = inspect(APP)
    labels = app['Config']['Labels']
    app_env = dict(item.split('=', 1) for item in app['Config'].get('Env', []) if '=' in item)
    try:
        platform_key_valid = len(base64.b64decode(app_env.get('SALEMAX_PLATFORM_KEY_BASE64', ''), validate=True)) == 32
    except Exception:
        platform_key_valid = False
    if not platform_key_valid:
        raise RuntimeError('Stable platform encryption key is unavailable')
    if app['Image'] != IMAGE or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Application image or health differs from the reviewed production baseline')

    mode = stat.S_IMODE(PRIOR.stat().st_mode)
    if mode != 0o700 or PRIOR.stat().st_uid != 0:
        raise RuntimeError('Latest protected rollback snapshot is not root-owned mode 0700')
    prior_result = json.loads((PRIOR / 'result.json').read_text())
    if prior_result.get('sourceCommit') != 'b3a940b81d9a2ed5542016196c2b5c3b42b5dd34':
        raise RuntimeError('Latest protected snapshot does not match the deployment ledger')
    base_files = (PRIOR / 'compose-files.before.txt').read_text().splitlines()
    env_files = (PRIOR / 'compose-env-files.before.txt').read_text().splitlines()
    manual_file = PRIOR / 'compose-manual-vars.json'
    manual = json.loads(manual_file.read_text())
    workdir = (PRIOR / 'compose-working-dir.before.txt').read_text().strip()
    old_chain = base_files + [PRIOR_LAST_OVERLAY]
    active_files = labels.get('com.docker.compose.project.config_files', '').split(',')
    active_envs = labels.get('com.docker.compose.project.environment_file', '').split(',')
    if active_files != old_chain or active_envs != env_files or labels.get('com.docker.compose.project.working_dir') != workdir:
        raise RuntimeError('Active Compose chain differs from the latest reviewed release')
    if not manual_file.is_file() or len(active_files) != 140 or len(env_files) != 11:
        raise RuntimeError('Protected Compose rollback inputs are incomplete')
    if any(not Path(path).is_file() for path in old_chain + env_files):
        raise RuntimeError('An active Compose input is unavailable')

    for name, identity in json.loads((PRIOR / 'support-services-before.json').read_text()).items():
        if name not in SUPPORT or inspect(name)['Id'] != identity:
            raise RuntimeError('A support service differs from the latest reviewed release')
    support = {name: inspect(name)['Id'] for name in SUPPORT}

    for expected, relative in manifest:
        target = '/app/' + relative
        if expected == 'new':
            if subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', target], capture_output=True).returncode:
                raise RuntimeError('Expected runtime target is already present: ' + relative)
        elif run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
            raise RuntimeError('Production source differs from the reviewed preimage: ' + relative)

    os.umask(0o077)
    release = Path('/opt/salemax/releases/retail-commerce-' + commit[:12])
    backup = Path('/opt/salemax/shared/rollback-retail-commerce-' + commit[:12])
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback snapshot already exists')
    backup.mkdir(mode=0o700)
    release.mkdir(mode=0o755)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    for relative in runtime_paths:
        target = runtime / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        shutil.copyfile(stage / relative, target)
        target.chmod(0o644)
    for name, value in {
        'source-commit.txt': commit + '\n',
        'compose-files.before.txt': '\n'.join(old_chain) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.before.txt': workdir + '\n',
        'manifest.txt': (stage / 'manifest.txt').read_text(),
        'artifact-hashes.json': json.dumps(artifact_hashes, sort_keys=True, indent=2) + '\n',
    }.items():
        (backup / name).write_text(value)
    shutil.copyfile(manual_file, backup / 'compose-manual-vars.json')
    (backup / 'compose-manual-vars.json').chmod(0o600)

    safe_app = {
        'id': app['Id'], 'image': app['Image'], 'imageName': app['Config'].get('Image'),
        'state': app['State'].get('Status'), 'health': app['State'].get('Health', {}).get('Status'),
        'restartCount': app['RestartCount'], 'mounts': app['Mounts'],
        'compose': {key: labels[key] for key in ('com.docker.compose.project.config_files',
                   'com.docker.compose.project.environment_file', 'com.docker.compose.project.working_dir')},
    }
    (backup / 'app-before.json').write_text(json.dumps(safe_app, indent=2) + '\n')
    (backup / 'support-services-before.json').write_text(json.dumps(support, indent=2) + '\n')

    preimages = {}
    overlay_mounts = []
    for expected, relative in manifest:
        source_path = runtime / relative
        preimages[relative] = expected if expected != 'new' else None
        if expected != 'new':
            saved = backup / 'preimages' / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            run('docker', 'cp', APP + ':/app/' + relative, str(saved))
            if hash_path(saved) != expected:
                raise RuntimeError('Captured file preimage differs: ' + relative)
        overlay_mounts.append({'type': 'bind', 'source': str(source_path), 'target': '/app/' + relative,
                               'read_only': True, 'bind': {'create_host_path': False}})
    (backup / 'file-preimage-hashes.json').write_text(json.dumps(preimages, sort_keys=True, indent=2) + '\n')
    (backup / 'release-overlay.json').write_text(json.dumps(overlay_mounts, indent=2) + '\n')
    overlay = release / 'compose.retail-commerce.json'
    overlay.write_text(json.dumps({'services': {'app': {'volumes': overlay_mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)

    provided = set()
    for path in env_files:
        for line in Path(path).read_text().splitlines():
            match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
            if match:
                provided.add(match[1])
    referenced = set()
    for path in old_chain:
        referenced.update(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(path).read_text()))
    for path in env_files:
        if not Path(path).is_file():
            raise RuntimeError('An environment file in the active Compose chain is unavailable')
    live_env = app_env
    env = os.environ.copy()
    env.update(manual)
    for key in referenced - provided:
        if key not in env:
            if key not in live_env:
                raise RuntimeError('Missing Compose interpolation variable')
            env[key] = live_env[key]
    common = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for path in env_files:
        common.extend(['--env-file', path])
    for path in old_chain:
        common.extend(['-f', path])
    candidate = common + ['-f', str(overlay)]
    compose_inputs = old_chain + env_files
    input_hashes = {path: hash_path(path) for path in compose_inputs}
    before_config = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after_config = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    before_services, after_services = before_config.pop('services'), after_config.pop('services')
    before_app, after_app = before_services.pop('app'), after_services.pop('app')
    if before_config != after_config or before_services != after_services:
        raise RuntimeError('Candidate changes project metadata or a non-app service')
    old_volumes, new_volumes = before_app.pop('volumes'), after_app.pop('volumes')
    if before_app != after_app:
        raise RuntimeError('Candidate changes app configuration outside reviewed runtime mounts')
    old_by_target = {row['target']: row for row in old_volumes}
    expected_by_target = dict(old_by_target)
    expected_by_target.update({row['target']: row for row in overlay_mounts})
    actual_by_target = {row['target']: row for row in new_volumes}
    replacements = {row['target'] for row in overlay_mounts}
    def mount_id(row):
        return row.get('type'), row.get('source'), row['target'], row.get('read_only', False)
    for target in expected_by_target.keys() | actual_by_target.keys():
        if target not in expected_by_target or target not in actual_by_target:
            raise RuntimeError('Candidate adds or removes an unreviewed runtime mount')
        if mount_id(expected_by_target[target]) != mount_id(actual_by_target[target]):
            raise RuntimeError('Candidate mount differs from the reviewed release')
        if target not in replacements and expected_by_target[target] != actual_by_target[target]:
            raise RuntimeError('Candidate changes an unrelated runtime mount')
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, sort_keys=True, indent=2) + '\n')
    new_chain = old_chain + [str(overlay)]
    restore_helper(backup, old_chain, env_files, workdir, overlay, new_chain, support,
                   {relative: expected for expected, relative in manifest if expected != 'new'},
                   [relative for expected, relative in manifest if expected == 'new'])

    for mount in overlay_mounts:
        if mount['target'].endswith('.js'):
            run('docker', 'run', '--rm', '--network', 'none', '-v', mount['source'] + ':/verify.js:ro',
                '--entrypoint', 'node', app['Image'], '--check', '/verify.js')
    if any(hash_path(path) != value for path, value in input_hashes.items()):
        raise RuntimeError('Compose input changed after preflight')
    if inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running application changed during preflight')

    schema_before = json.loads(db_call('snapshot'))
    before_ledger = {row['migration_name']: row for row in schema_before['ledger']}
    required_prior = RETAIL_MIGRATIONS[:-1]
    if any(name not in before_ledger or before_ledger[name]['status'] != 'applied' for name in required_prior):
        raise RuntimeError('An earlier retail migration is missing or incomplete')
    migration_hash = artifact_hashes['database/migrations/20270132_retail_connected_stores.sql']
    existing_connected_migration = before_ledger.get(MIGRATIONS[0])
    if existing_connected_migration:
        if (existing_connected_migration['status'] != 'applied'
                or existing_connected_migration['checksum'] != migration_hash
                or existing_connected_migration['statement_count'] != 9
                or existing_connected_migration['statements_completed'] != 9
                or set(schema_before['tables']) != PRIOR_TABLES | NEW_TABLES):
            raise RuntimeError('Existing Connected Stores migration differs from the reviewed additive schema')
        migration_previously_applied = True
    else:
        if set(schema_before['tables']) != PRIOR_TABLES:
            raise RuntimeError('Retail schema differs from the reviewed pre-migration state')
        migration_previously_applied = False
    if schema_before['enabledStores'] or schema_before['entitledPlans'] or schema_before['activeCommerceAssignments']:
        raise RuntimeError('Commerce entitlement or storefront activation is not closed')
    (backup / 'database-schema-before.json').write_text(json.dumps(schema_before, indent=2) + '\n')

    migration_source = (runtime / 'database/migrations/20270132_retail_connected_stores.sql').read_text()
    if migration_previously_applied:
        (backup / (MIGRATIONS[0] + '.result.json')).write_text(json.dumps(
            {'status': 'already_applied', 'sourceCommit': 'previous guarded attempt',
             'checksum': migration_hash, 'statementCount': 9}, indent=2) + '\n')
    else:
        for migration in MIGRATIONS:
            (backup / (migration + '.result.json')).write_text(db_call('apply', migration, migration_source))
    schema_after = json.loads(db_call('verify'))
    after_ledger = {row['migration_name']: row for row in schema_after['ledger']}
    for migration in RETAIL_MIGRATIONS:
        if migration not in after_ledger or after_ledger[migration]['status'] != 'applied':
            raise RuntimeError('Retail migration ledger is incomplete after applying Connected Stores')
    migration = after_ledger[MIGRATIONS[0]]
    expected_tables = PRIOR_TABLES | NEW_TABLES
    if set(schema_after['tables']) != expected_tables:
        raise RuntimeError('Connected Stores schema table set is incomplete')
    if (migration['checksum'] != migration_hash or migration['statement_count'] != 9
            or migration['statements_completed'] != 9):
        raise RuntimeError('Connected Stores migration checksum or statement count differs')
    if schema_after['newTableRows'] != {name: 0 for name in sorted(NEW_TABLES)}:
        raise RuntimeError('New Connected Stores tables contain unexpected records')
    if schema_after['enabledStores'] or schema_after['entitledPlans'] or schema_after['activeCommerceAssignments']:
        raise RuntimeError('Storefront or commerce entitlement became active')
    (backup / 'database-schema-after.json').write_text(json.dumps(schema_after, indent=2) + '\n')

    started = False
    try:
        if any(hash_path(path) != value for path, value in input_hashes.items()):
            raise RuntimeError('Compose input changed before app recreation')
        started = True
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        expected_mounts = {row['Destination']: row['Source'] for row in app['Mounts']}
        for row in overlay_mounts:
            expected_mounts[row['target']] = row['source']
        current_mounts = {row['Destination']: row['Source'] for row in current['Mounts']}
        if current['Image'] != app['Image'] or current_mounts != expected_mounts:
            raise RuntimeError('Application image or mounts differ from the reviewed app-only overlay')
        previous_env = dict(item.split('=', 1) for item in app['Config'].get('Env', []) if '=' in item)
        current_env = dict(item.split('=', 1) for item in current['Config'].get('Env', []) if '=' in item)
        if current_env != previous_env or len(current_env) != len(current['Config'].get('Env', [])):
            raise RuntimeError('Application environment changed during the release')
        if {name: inspect(name)['Id'] for name in SUPPORT} != support:
            raise RuntimeError('A supporting service identity changed during app release')
        for _, relative in manifest:
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + relative).split()[0] != artifact_hashes[relative]:
                raise RuntimeError('Live runtime file hash differs from the staged artifact: ' + relative)

        if http('/healthz')[0] != 200:
            raise RuntimeError('Public health check failed')
        if http('/api/workspace/retail/connectors')[0] not in (401, 403):
            raise RuntimeError('Anonymous Connected Stores workspace access was not denied')
        invalid_slug = 'release-check-' + commit[:12]
        if http('/business/' + invalid_slug + '/shop/catalog')[0] != 404:
            raise RuntimeError('Unknown public store returned catalog data')
        shell_code, shell, _ = http('/user')
        if shell_code != 200 or b'/retail-workspace.js?v=20261106-shopify-woo-images3' not in shell:
            raise RuntimeError('Business shell does not reference the Connected Stores asset')
        for url, relative in (
            ('/retail-workspace.js?v=20261106-shopify-woo-images3', 'client/public/retail-workspace.js'),
            ('/retail-workspace.css?v=20261106-shopify-woo-images3', 'client/public/retail-workspace.css'),
            ('/api/retail-connectors/woocommerce-plugin', 'integrations/woocommerce/7network-retail-connector.zip'),
        ):
            status, body, _ = http(url)
            if status != 200 or digest(body) != artifact_hashes[relative]:
                raise RuntimeError('Served asset does not match the staged artifact: ' + url.split('?')[0])

        result = {
            'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
            'image': current['Image'], 'runtimeFiles': len(overlay_mounts), 'appMounts': len(current['Mounts']),
            'migration': {'file': MIGRATIONS[0], 'status': migration['status'],
                          'checksum': migration['checksum'], 'statementCount': migration['statement_count'],
                          'statementsCompleted': migration['statements_completed'],
                          'alreadyAppliedBeforeAppRelease': migration_previously_applied},
            'databaseTables': len(schema_after['tables']), 'newTableRows': schema_after['newTableRows'],
            'enabledStores': schema_after['enabledStores'], 'entitledPlans': schema_after['entitledPlans'],
            'activeCommerceAssignments': schema_after['activeCommerceAssignments'],
            'healthz': 200, 'anonymousWorkspaceDenied': True, 'unknownStoreCatalog': 404,
            'shellAndServedAssetHashesVerified': True, 'supportServicesUnchanged': True,
            'shopifyCredentialsOrMerchantStore': 'not configured or connected by this release',
            'storefrontActivation': 'closed', 'signedInOwnerPilot': 'open',
        }
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        (release / 'release-result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        if started:
            run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
            restored = wait_healthy()
            if restored['Image'] != app['Image'] or any(inspect(name)['Id'] != identity for name, identity in support.items()):
                raise RuntimeError('App rollback health or support verification failed')
            for expected, relative in manifest:
                target = '/app/' + relative
                if expected == 'new':
                    if subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', target], capture_output=True).returncode:
                        raise RuntimeError('New target remained after app rollback')
                elif run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
                    raise RuntimeError('App preimage did not restore after failed release')
            (backup / 'failed-app-release-restored.json').write_text(json.dumps(
                {'sourceCommit': commit, 'appId': restored['Id'], 'migrationKept': list(MIGRATIONS),
                 'applicationRestored': True, 'supportServicesUnchanged': True}, indent=2) + '\n')
        raise


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve(), sys.argv[2])
