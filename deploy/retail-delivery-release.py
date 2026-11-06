"""Deploy the reviewed delivery-recovery increment onto the verified retail overlay chain."""
import hashlib
import base64
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


APP = 'salemax-app-1'
PRIOR = Path('/opt/salemax/shared/rollback-private-inventory-4707675a221e')
ACTIVE_INVENTORY_OVERLAY = Path('/opt/salemax/releases/private-inventory-4707675a221e/compose.inventory.json')
ACTIVE_COMMERCE_OVERLAY = Path('/opt/salemax/releases/retail-commerce-a8549c860c25/compose.retail-commerce.json')
EXPECTED_BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
MIGRATIONS = ('20270128_retail_delivery_retries_and_proof.sql',)
RETAIL_MIGRATIONS = ('20270125_private_business_inventory.sql', '20270126_retail_commerce.sql',
                     '20270127_retail_cash_and_returns.sql', '20270128_retail_delivery_retries_and_proof.sql')
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1')


def run(*args, env=None, input_text=None):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def hash_path(path):
    return sha(Path(path).read_bytes())


def http(path):
    try:
        with urllib.request.urlopen('https://7network.live' + path, timeout=12) as response:
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


def db_call(action, file=None, sql=None):
    program = r"""
const fs=require('node:fs');
const crypto=require('node:crypto');
const mysql=require('/app/node_modules/mysql2/promise');
const runner=require('/app/database/migration-runner');
(async()=>{
  const action=process.argv[1];
  const conn=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
  try {
    if(action==='snapshot'){
      const [[schema]]=await conn.query('SHOW CREATE TABLE sx_business_stock_movements');
      const [ledger]=await conn.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name IN (?,?,?,?) ORDER BY migration_name',['20270125_private_business_inventory.sql','20270126_retail_commerce.sql','20270127_retail_cash_and_returns.sql','20270128_retail_delivery_retries_and_proof.sql']);
      const [tables]=await conn.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('sx_retail_store','sx_retail_listings','sx_retail_orders','sx_retail_stock_reservations','sx_retail_cash_receipts','sx_retail_cash_settlements','sx_retail_cash_settlement_orders','sx_retail_returns','sx_retail_return_lines','sx_retail_delivery_proofs','sx_retail_delivery_attempts') ORDER BY table_name");
      console.log(JSON.stringify({inventorySchema:schema['Create Table'],commerceTablesBefore:tables.map(x=>x.table_name),ledger}));
    } else if(action==='apply'){
      const file=process.argv[2],sources=JSON.parse(fs.readFileSync(0,'utf8')),migrations=runner.discover('/app/database/migrations');
      for(const [name,source] of Object.entries(sources)) migrations.push({file:name,checksum:crypto.createHash('sha256').update(source).digest('hex'),statements:runner.splitSql(source)});
      console.log(JSON.stringify(await runner.applyMigrations(conn,migrations,{only:file})));
    } else if(action==='verify'){
      const [rows]=await conn.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name IN (?,?,?,?) ORDER BY migration_name',['20270125_private_business_inventory.sql','20270126_retail_commerce.sql','20270127_retail_cash_and_returns.sql','20270128_retail_delivery_retries_and_proof.sql']);
      const [tables]=await conn.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('sx_retail_store','sx_retail_listings','sx_retail_orders','sx_retail_stock_reservations','sx_retail_cash_receipts','sx_retail_cash_settlements','sx_retail_cash_settlement_orders','sx_retail_returns','sx_retail_return_lines','sx_retail_delivery_proofs','sx_retail_delivery_attempts') ORDER BY table_name");
      const [[column]]=await conn.query("SHOW COLUMNS FROM sx_retail_orders LIKE 'delivery_state'");
      const [[stores]]=await conn.query('SELECT COUNT(*) AS enabledStores FROM sx_retail_store WHERE enabled=1');
      const [[plans]]=await conn.query("SELECT COUNT(*) AS entitledPlans FROM sx_plan_versions WHERE JSON_CONTAINS(capabilities,JSON_QUOTE('retail.commerce'))");
      const [[assignments]]=await conn.query("SELECT COUNT(*) AS activeCommerceAssignments FROM sx_plan_assignments a JOIN sx_plan_versions p ON p.id=a.plan_version_id WHERE a.status='active' AND (a.expires_at IS NULL OR a.expires_at>UTC_TIMESTAMP()) AND JSON_CONTAINS(p.capabilities,JSON_QUOTE('retail.commerce'))");
      console.log(JSON.stringify({ledger:rows,tables:tables.map(x=>x.table_name),deliveryStateType:column?.Type,enabledStores:Number(stores.enabledStores),entitledPlans:Number(plans.entitledPlans),activeCommerceAssignments:Number(assignments.activeCommerceAssignments)}));
    } else throw new Error('INVALID_ACTION');
  } finally { await conn.end(); }
})().catch(error=>{console.error('Retail database operation stopped:',/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'DB_OPERATION_FAILED');process.exitCode=1;});
"""
    args = ['docker', 'exec', '-i', APP, 'node', '-e', program, action]
    if file:
        args.append(file)
    result = subprocess.run(args, input=sql, capture_output=True, text=True)
    if result.returncode:
        code = re.search(r'Retail database operation stopped: ([A-Z0-9_]+)', result.stderr)
        raise RuntimeError('Retail database operation failed: ' + (code[1] if code else 'details withheld'))
    return result.stdout


def wait_healthy():
    for _ in range(40):
        current = inspect(APP)
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(2)
    raise RuntimeError('Application did not return to healthy state')


def current_status(entries, support):
    app = inspect(APP)
    if app['Image'] != entries['image'] or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Application image or health changed unexpectedly')
    if any(inspect(name)['Id'] != identity for name, identity in support.items()):
        raise RuntimeError('A supporting service identity changed unexpectedly')
    actual_mounts = {row['Destination']: row['Source'] for row in app['Mounts']}
    expected_mounts = {row['Destination']: row['Source'] for row in entries['mounts']}
    for row in entries['overlay_mounts']:
        expected_mounts[row['target']] = row['source']
        if actual_mounts.get(row['target']) != row['source']:
            raise RuntimeError('Runtime mount does not match the reviewed release')
        actual = run('docker', 'exec', APP, 'sha256sum', '/app/' + row['name']).split()[0]
        if actual != row['sha256']:
            raise RuntimeError('Runtime file hash differs from the reviewed release')
    if actual_mounts != expected_mounts:
        raise RuntimeError('Application mount map changed outside the reviewed release')
    return app


def restore_helper(backup, base_files, env_files, workdir, overlay, new_chain, prior_ids, preimages, new_paths):
    source = f'''import json, os, subprocess, time
APP={APP!r}
BASE={EXPECTED_BASE!r}
BACKUP={str(backup)!r}
FILES={base_files!r}
ENVS={env_files!r}
WORKDIR={workdir!r}
OVERLAY={str(overlay)!r}
NEW_CHAIN={new_chain!r}
PRIOR_IDS={prior_ids!r}
PREIMAGES={preimages!r}
NEW_PATHS={new_paths!r}
assert os.environ.get("SALEMAX_DEPLOY_LOCK_HELD")=="1", "production lock required"
assert subprocess.check_output(["hostname"],text=True).strip()=="carsqatar-prod-01"
assert os.path.realpath("/opt/salemax/current")==BASE
def inspect(name): return json.loads(subprocess.check_output(["docker","inspect",name],text=True))[0]
app=inspect(APP)
assert app["Config"]["Labels"]["com.docker.compose.project.config_files"]==",".join(NEW_CHAIN), "newer application overlay is active"
manual=json.load(open(BACKUP+"/compose-manual-vars.json"))
live=dict(item.split("=",1) for item in app["Config"].get("Env",[]) if "=" in item)
env=dict(os.environ); env.update(manual)
provided=set()
for path in ENVS:
    for line in open(path):
        import re
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
if app["Image"] not in PRIOR_IDS["imageIds"]: raise SystemExit("previous image changed")
for name, identity in PRIOR_IDS["support"].items():
    if inspect(name)["Id"]!=identity: raise SystemExit("support service changed during rollback")
if app["Config"]["Labels"]["com.docker.compose.project.config_files"]!=",".join(FILES): raise SystemExit("previous Compose chain was not restored")
for relative, digest in PREIMAGES.items():
    actual=subprocess.check_output(["docker","exec",APP,"sha256sum","/app/"+relative],text=True).split()[0]
    if actual!=digest: raise SystemExit("prior file preimage did not restore")
for relative in NEW_PATHS:
    if subprocess.run(["docker","exec",APP,"test","!","-e","/app/"+relative]).returncode: raise SystemExit("new release file remains mounted")
before=json.load(open(BACKUP+"/app-before.json"))
mounts=lambda rows: sorted((row["Destination"],row["Source"],row.get("RW"),row.get("Type")) for row in rows)
if mounts(app["Mounts"])!=mounts(before["mounts"]): raise SystemExit("previous application mount map differs")
print(json.dumps({{"restoredFiles":len({base_files}),"keptAdditiveMigrations":{MIGRATIONS!r},"supportServicesUnchanged":True}}))
'''
    (backup / 'restore-app-under-lock.py').write_text(source)
    (backup / 'restore-app-under-lock.py').chmod(0o600)


def main(stage, commit):
    if os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1' or os.geteuid() != 0:
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath('/opt/salemax/current') != EXPECTED_BASE:
        raise RuntimeError('Production host or base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if (stage / 'source-commit.txt').read_text().strip() != commit:
        raise RuntimeError('Staged source commit does not match the release argument')

    manifest = parse_manifest(stage)
    artifact_hashes = json.loads((stage / 'artifact-hashes.json').read_text())
    runtime_paths = {path for _, path in manifest}
    if set(artifact_hashes) != runtime_paths:
        raise RuntimeError('Artifact hash list differs from the runtime manifest')
    for _, relative in manifest:
        source = stage / relative
        if source.is_symlink() or not source.is_file() or hash_path(source) != artifact_hashes[relative]:
            raise RuntimeError('Staged runtime artifact failed its hash check')

    app = inspect(APP)
    labels = app['Config']['Labels']
    live_env = dict(item.split('=', 1) for item in app['Config'].get('Env', []) if '=' in item)
    try:
        platform_key_valid = len(base64.b64decode(live_env.get('SALEMAX_PLATFORM_KEY_BASE64', ''), validate=True)) == 32
    except Exception:
        platform_key_valid = False
    if not platform_key_valid:
        raise RuntimeError('Stable delivery-proof encryption key is unavailable')
    base_files = (PRIOR / 'compose-files.after.txt').read_text().splitlines()
    env_files = (PRIOR / 'compose-env-files.after.txt').read_text().splitlines()
    manual_file = PRIOR / 'compose-manual-vars.json'
    manual = json.loads(manual_file.read_text())
    workdir = (PRIOR / 'compose-working-dir.before.txt').read_text().strip()
    old_chain = base_files + [str(ACTIVE_INVENTORY_OVERLAY), str(ACTIVE_COMMERCE_OVERLAY)]
    active_files = labels['com.docker.compose.project.config_files'].split(',')
    active_envs = labels['com.docker.compose.project.environment_file'].split(',')
    if active_files != old_chain or active_envs != env_files or labels['com.docker.compose.project.working_dir'] != workdir:
        raise RuntimeError('Active Compose or environment inputs differ from the reviewed inventory release')
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135':
        raise RuntimeError('Application health or image differs from the reviewed base')
    if not ACTIVE_INVENTORY_OVERLAY.is_file() or not ACTIVE_COMMERCE_OVERLAY.is_file() or not manual_file.is_file():
        raise RuntimeError('Protected inventory or commerce rollback inputs are incomplete')

    for expected, relative in manifest:
        target = '/app/' + relative
        if expected == 'new':
            absent = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', target], capture_output=True)
            if absent.returncode:
                raise RuntimeError('Expected runtime target is not absent: ' + relative)
        else:
            actual = run('docker', 'exec', APP, 'sha256sum', target).split()[0]
            if actual != expected:
                raise RuntimeError('Production source diverged from the reviewed preimage: ' + relative)

    os.umask(0o077)
    release = Path('/opt/salemax/releases/retail-commerce-' + commit[:12])
    backup = Path('/opt/salemax/shared/rollback-retail-commerce-' + commit[:12])
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback snapshot already exists')
    backup.mkdir(mode=0o700)
    release.mkdir(mode=0o755)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    for field, value in {
        'source-commit.txt': commit + '\n',
        'compose-files.before.txt': '\n'.join(old_chain) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.before.txt': workdir + '\n',
        'manifest.txt': (stage / 'manifest.txt').read_text(),
        'artifact-hashes.json': json.dumps(artifact_hashes, sort_keys=True, indent=2) + '\n',
    }.items():
        (backup / field).write_text(value)
    shutil.copyfile(manual_file, backup / 'compose-manual-vars.json')
    (backup / 'compose-manual-vars.json').chmod(0o600)

    safe_app = {
        'id': app['Id'], 'image': app['Image'], 'imageName': app['Config'].get('Image'),
        'state': app['State'].get('Status'), 'health': app['State'].get('Health', {}).get('Status'),
        'restartCount': app['RestartCount'], 'mounts': app['Mounts'],
        'compose': {key: labels[key] for key in ('com.docker.compose.project.config_files',
                   'com.docker.compose.project.environment_file','com.docker.compose.project.working_dir')},
    }
    (backup / 'app-before.json').write_text(json.dumps(safe_app, indent=2) + '\n')
    support = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services-before.json').write_text(json.dumps(support, indent=2) + '\n')
    preimage_hashes = {}
    overlay_mounts = []
    for expected, relative in manifest:
        source = runtime / relative
        source.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        shutil.copyfile(stage / relative, source)
        source.chmod(0o644)
        preimage_hashes[relative] = expected if expected != 'new' else None
        if expected != 'new':
            saved = backup / 'preimages' / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            run('docker', 'cp', APP + ':/app/' + relative, str(saved))
            if hash_path(saved) != expected:
                raise RuntimeError('Captured file preimage differs: ' + relative)
        overlay_mounts.append({'type': 'bind', 'source': str(source), 'target': '/app/' + relative,
                               'read_only': True, 'bind': {'create_host_path': False}})
    (backup / 'file-preimage-hashes.json').write_text(json.dumps(preimage_hashes, sort_keys=True, indent=2) + '\n')
    (backup / 'release-overlay.json').write_text(json.dumps(overlay_mounts, indent=2) + '\n')
    overlay = release / 'compose.retail-commerce.json'
    overlay.write_text(json.dumps({'services': {'app': {'volumes': overlay_mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)

    env_files_names = set()
    for path in env_files:
        for line in Path(path).read_text().splitlines():
            match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
            if match:
                env_files_names.add(match[1])
    referenced = set()
    for path in old_chain:
        referenced.update(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(path).read_text()))
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    env = os.environ.copy()
    env.update(manual)
    for key in referenced - env_files_names:
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
    old_rows = before_app.pop('volumes')
    new_rows = after_app.pop('volumes')
    if before_app != after_app:
        raise RuntimeError('Candidate changes app configuration outside its runtime mounts')
    old_by_target = {row['target']: row for row in old_rows}
    expected_by_target = dict(old_by_target)
    expected_by_target.update({row['target']: row for row in overlay_mounts})
    actual_by_target = {row['target']: row for row in new_rows}
    def mount_id(row):
        return row.get('type'), row.get('source'), row['target'], row.get('read_only', False)
    replacements = {row['target'] for row in overlay_mounts}
    for target in expected_by_target.keys() | actual_by_target.keys():
        if target not in expected_by_target or target not in actual_by_target:
            raise RuntimeError('Candidate adds or removes an unreviewed runtime mount')
        if mount_id(expected_by_target[target]) != mount_id(actual_by_target[target]):
            raise RuntimeError('Candidate mount target differs from the reviewed release')
        if target not in replacements and expected_by_target[target] != actual_by_target[target]:
            raise RuntimeError('Candidate changes an unrelated runtime mount')

    (backup / 'compose-input-hashes.json').write_text(json.dumps(
        {path: digest for path, digest in input_hashes.items() if path not in env_files}, sort_keys=True, indent=2) + '\n')
    restore_chain = old_chain + [str(overlay)]
    restore_helper(backup, old_chain, env_files, workdir, overlay, restore_chain,
                   {'imageIds': [app['Image']], 'support': support},
                   {relative: expected for expected, relative in manifest if expected != 'new'},
                   [relative for expected, relative in manifest if expected == 'new'])

    for row in overlay_mounts:
        if row['target'].endswith('.js'):
            run('docker', 'run', '--rm', '--network', 'none', '-v', row['source'] + ':/verify.js:ro',
                '--entrypoint', 'node', app['Image'], '--check', '/verify.js')
    if any(hash_path(path) != digest for path, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed after preflight')
    if inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app changed after preflight')
    services_before = {name: inspect(name)['Id'] for name in SUPPORT}
    if services_before != support:
        raise RuntimeError('A supporting service changed during preflight')

    schema_before = json.loads(db_call('snapshot'))
    prior_ledger = {row['migration_name'] for row in schema_before['ledger']}
    ledger_before = {row['migration_name']: row for row in schema_before['ledger']}
    required_before = RETAIL_MIGRATIONS[:3]
    if any(name not in ledger_before or ledger_before[name]['status'] != 'applied' for name in required_before):
        raise RuntimeError('An earlier retail migration is missing or incomplete')
    if any(name in prior_ledger for name in MIGRATIONS):
        raise RuntimeError('Delivery recovery migration is already present in the live database')
    expected_prior_tables = {'sx_retail_store','sx_retail_listings','sx_retail_orders','sx_retail_stock_reservations',
        'sx_retail_cash_receipts','sx_retail_cash_settlements','sx_retail_cash_settlement_orders','sx_retail_returns','sx_retail_return_lines'}
    if set(schema_before['commerceTablesBefore']) != expected_prior_tables:
        raise RuntimeError('Retail schema differs from the reviewed pre-migration state')
    (backup / 'database-schema-before.json').write_text(json.dumps(schema_before, indent=2) + '\n')
    migration_sources = {name: (runtime / 'database/migrations' / name).read_text() for name in MIGRATIONS}
    for migration in MIGRATIONS:
        output = db_call('apply', migration, json.dumps(migration_sources))
        (backup / (migration + '.result.json')).write_text(output)
    migration_state = json.loads(db_call('verify'))
    rows = {row['migration_name']: row for row in migration_state['ledger']}
    for migration in MIGRATIONS:
        if migration not in rows or rows[migration]['status'] != 'applied' or rows[migration]['checksum'] != artifact_hashes['database/migrations/' + migration]:
            raise RuntimeError('Commerce migration ledger verification failed')
    if len(migration_state['tables']) != 11 or not {'failed','delivered'}.issubset(set(migration_state['deliveryStateType'].strip("enum()'").split("','"))):
        raise RuntimeError('Commerce schema verification failed')
    rows_by_name = {row['migration_name']: row for row in migration_state['ledger']}
    if any(name not in rows_by_name or rows_by_name[name]['status'] != 'applied' for name in RETAIL_MIGRATIONS):
        raise RuntimeError('Retail migration ledger is incomplete after applying delivery recovery')
    if migration_state['enabledStores'] or migration_state['entitledPlans'] or migration_state['activeCommerceAssignments']:
        raise RuntimeError('Commerce rollout is not behind disabled plan and store entitlements')
    (backup / 'database-schema-after.json').write_text(json.dumps(migration_state, indent=2) + '\n')

    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        overlay_rows = []
        for (expected, relative) in manifest:
            overlay_rows.append({'name': relative, 'target': '/app/' + relative,
                                 'source': str(runtime / relative), 'sha256': artifact_hashes[relative]})
        snapshot = {'image': app['Image'], 'mounts': app['Mounts'], 'overlay_mounts': overlay_rows}
        support_after = {name: inspect(name)['Id'] for name in SUPPORT}
        if support_after != support:
            raise RuntimeError('A support service changed during app release')
        current_status(snapshot, support)
        if current['Image'] != app['Image']:
            raise RuntimeError('Application image changed during source overlay release')
        if http('/healthz')[0] != 200:
            raise RuntimeError('Public application health check failed')
        if http('/api/workspace/retail/store')[0] not in (401, 403):
            raise RuntimeError('Anonymous workspace commerce access was not denied')
        invalid_slug = 'release-check-' + commit[:12]
        if http('/business/' + invalid_slug + '/shop/catalog')[0] != 404:
            raise RuntimeError('Unknown public store returned catalog data')
        shell_code, shell_body, _ = http('/user')
        if shell_code != 200 or b'/retail-workspace.js?v=ec04-delivery-proof1' not in shell_body:
            raise RuntimeError('Business shell did not serve the current commerce asset key')
        css_code, css_body, _ = http('/retail-shop.css?v=ec04-delivery-proof1')
        if css_code != 200 or sha(css_body) != artifact_hashes['client/public/retail-shop.css']:
            raise RuntimeError('Storefront stylesheet did not match the release')
        js_code, js_body, _ = http('/retail-shop.js?v=ec04-delivery-proof1')
        if js_code != 200 or sha(js_body) != artifact_hashes['client/public/retail-shop.js']:
            raise RuntimeError('Storefront script did not match the release')
        js_code, js_body, _ = http('/retail-workspace.js?v=ec04-delivery-proof1')
        if js_code != 200 or sha(js_body) != artifact_hashes['client/public/retail-workspace.js']:
            raise RuntimeError('Retail workspace script did not match the release')
        release_result = {
            'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'image': current['Image'],
            'migrationFiles': list(MIGRATIONS), 'migrations': migration_state['ledger'],
            'runtimeFiles': len(overlay_mounts), 'appMounts': len(current['Mounts']),
            'supportServicesUnchanged': True, 'healthz': 200, 'anonymousCommerceDenied': True,
            'unknownStoreCatalog': 404, 'shellAssetKeyVerified': True,
            'storefrontEntitlementNotAssigned': True, 'storefrontsNotEnabled': True,
            'pwaShellAssetsVerified': True, 'customDomainPilotNotEnabled': True,
        }
        (backup / 'result.json').write_text(json.dumps(release_result, indent=2) + '\n')
        (release / 'release-result.json').write_text(json.dumps(release_result, indent=2) + '\n')
        print(json.dumps(release_result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        prior = wait_healthy()
        if prior['Image'] != app['Image'] or any(inspect(name)['Id'] != identity for name, identity in support.items()):
            raise RuntimeError('App rollback health or support-service verification failed')
        for expected, relative in manifest:
            target = '/app/' + relative
            if expected == 'new':
                if subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', target], capture_output=True).returncode:
                    raise RuntimeError('New target remained after app rollback')
            elif run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
                raise RuntimeError('App preimage did not restore after failed release')
        (backup / 'failed-app-release-restored.json').write_text(json.dumps(
            {'sourceCommit': commit, 'appId': prior['Id'], 'migrationsKept': list(MIGRATIONS),
             'applicationRestored': True, 'supportServicesUnchanged': True}, indent=2) + '\n')
        raise


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve(), sys.argv[2])
