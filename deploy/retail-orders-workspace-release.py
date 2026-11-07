"""Stage, deploy and restore the guarded Retail Orders workspace release."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
LATEST_OVERLAY = '/opt/salemax/releases/website-funnel-stack-f6ef7385d3b9-20261107/compose.website-funnel-stack.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
EXPECTED_COMPOSE_FILES = 157
EXPECTED_ENV_FILES = 11
EXPECTED_MOUNTS = 157
MIGRATION = '20270202_retail_order_email_search.sql'
SUPPORT = (
    'salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
    'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db',
)
RUNTIME_FILES = (
    'client/public/index.html',
    'client/public/business-inventory.js',
    'client/public/retail-workspace.js',
    'client/public/retail-workspace.css',
    'client/public/tenant-crm-appearance.js',
    'client/public/retail-shop.html',
    'client/public/retail-shop.js',
    'client/public/retail-shop-sw.js',
    'modules/platform/retail-commerce-router.js',
    'modules/platform/retail-commerce.js',
)
STAGE_FILES = RUNTIME_FILES + ('client/public/retail-shop.css', 'database/migrations/' + MIGRATION,
                               'deploy/retail-orders-workspace-release.py')
MOUNT_FILES = RUNTIME_FILES + ('database/migrations/' + MIGRATION,)
OLD_HASHES = {
    'client/public/index.html': 'cfce7d16f55beb17b98fe5ea21308e15926ea84714b929e8e505c1f12b0c7e3b',
    'client/public/business-inventory.js': '7c1d8b0761159643400897d3a0d94041dce4d06b92df62900f6cc12ba3c19575',
    'client/public/retail-workspace.js': '7e2adcf30de4e00a86e076dd6eb6c908100ed1e777a978f3d812f0052f96593b',
    'client/public/retail-workspace.css': '490210dba690695537999f86e1a7cb0008b44d0856fb48bb9cf111b54205db5d',
    'client/public/tenant-crm-appearance.js': 'fb205ea9f6aee753a951a50a94742da2ed64b77947d286223fc9c77a62c67955',
    'client/public/retail-shop.html': 'd143a140475da74bf0583cafab26f3ae2bf2bab545c312777ca58373dd536ac3',
    'client/public/retail-shop.js': '8184fc50672314dfafadb7b2826cc0127b629b5bb7b7dd78fcf512a89decad09',
    'client/public/retail-shop.css': '410fa4916252cd2005df112f772b14f50ce66f723571c0f2e921f4bc51898c69',
    'client/public/retail-shop-sw.js': 'a1205313be8ffe6e269d9a24e826eb3b583fabea9cec939a9f7f949fb4063b11',
    'modules/platform/retail-commerce-router.js': '48ad2a84cb06e43fae6efe0d001a469329e1e0b9b55ad05ad468779bcd0740ba',
    'modules/platform/retail-commerce.js': '39a2c98f5596328de6865697f847c9cbc62730e8e8d225439a72ef54d95fda6b',
}
CACHE_REFS = (
    'business-inventory.js?v=20261107-inventory-store1',
    'retail-workspace.js?v=20261107-orders-ui1',
    'tenant-crm-appearance.js?v=20261107-storefront-profile1',
)
MIGRATION_PROGRAM = r"""
const fs=require('node:fs'),crypto=require('node:crypto');
const mysql=require('/app/node_modules/mysql2/promise');
const runner=require('/app/database/migration-runner');
(async()=>{const source=fs.readFileSync(0,'utf8');const migrations=runner.discover('/app/database/migrations');migrations.push({file:__MIGRATION_NAME__,checksum:crypto.createHash('sha256').update(source).digest('hex'),statements:runner.splitSql(source)});const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});try{console.log(JSON.stringify(await runner.applyMigrations(db,migrations,{only:__MIGRATION_NAME__})));}finally{await db.end();}})().catch(error=>{console.error('Migration stopped:',error.code||'MIGRATION_FAILED');process.exitCode=1;});
"""
SCHEMA_PROGRAM = r"""
const mysql=require('/app/node_modules/mysql2/promise');
(async()=>{const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});try{const [columns]=await db.query("SELECT COLUMN_NAME AS name,DATA_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_retail_orders' AND COLUMN_NAME='buyer_email'");const [indexes]=await db.query("SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_retail_orders' AND INDEX_NAME IN ('ix_sx_retail_orders_email','ix_sx_retail_orders_created') ORDER BY INDEX_NAME");const [ledger]=await db.query('SELECT migration_name,checksum,status,statements_completed,statement_count FROM salemax_schema_migrations WHERE migration_name=?',[__MIGRATION_NAME__]);console.log(JSON.stringify({columns,indexes,ledger}));}finally{await db.end();}})().catch(error=>{console.error(error.code||'SCHEMA_READ_FAILED');process.exitCode=1;});
"""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value, mode=0o600):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(mode)


def run(*args, env=None, input_data=None):
    result = subprocess.run(args, env=env, input=input_data, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for name in env_files:
        args += ['--env-file', name]
    for name in files:
        args += ['-f', name]
    return args


def wait_healthy():
    for _ in range(45):
        current = inspect(APP)
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')


def http_status(path, method='GET', payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request('https://7network.live' + path, data=data, method=method,
                                     headers={'Content-Type': 'application/json'} if data is not None else {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.read()


def stage(destination, commit):
    source = Path(__file__).resolve().parents[1]
    actual = run('git', '-C', str(source), 'rev-parse', 'HEAD').strip()
    dirty = run('git', '-C', str(source), 'status', '--porcelain', '--untracked-files=all').strip()
    if actual != commit or dirty:
        raise RuntimeError('Stage requires a clean checkout at the requested source commit')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if destination.exists():
        raise RuntimeError('Stage destination already exists')
    destination.mkdir(mode=0o700, parents=True)
    entries = {}
    try:
        for name in STAGE_FILES:
            data = (source / name).read_bytes()
            target = destination / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o600)
            entries[name] = sha(data)
        write_json(destination / 'source-manifest.json', {'sourceCommit': commit, 'files': entries}, 0o600)
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    print(json.dumps({'sourceCommit': commit, 'files': len(entries), 'stage': str(destination)}))


def validate_stage(folder, commit):
    manifest = json.loads((folder / 'source-manifest.json').read_text())
    if manifest.get('sourceCommit') != commit:
        raise RuntimeError('Staged source commit differs from requested release commit')
    files = {}
    for name in STAGE_FILES:
        path = folder / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('Staged source file is missing or not regular: ' + name)
        data = path.read_bytes()
        if manifest.get('files', {}).get(name) != sha(data):
            raise RuntimeError('Staged source hash mismatch: ' + name)
        files[name] = data
    return files


def database_snapshot():
    result = subprocess.run(['docker', 'exec', APP, 'node', '-e', SCHEMA_PROGRAM.replace('__MIGRATION_NAME__', json.dumps(MIGRATION))],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Unable to read Retail order schema metadata')
    return json.loads(result.stdout)


def apply_migration(data):
    program = MIGRATION_PROGRAM.replace('__MIGRATION_NAME__', json.dumps(MIGRATION))
    result = subprocess.run(['docker', 'exec', '-i', APP, 'node', '-e', program], input=data.decode('utf-8'),
                            capture_output=True, text=True)
    if result.returncode:
        code = re.search(r'Migration stopped: ([A-Z0-9_]+)', result.stderr)
        raise RuntimeError('Retail email migration failed: ' + (code[1] if code else 'details withheld'))
    return json.loads(result.stdout)


def verify_migration(snapshot, expected_hash):
    column = snapshot.get('columns', [])
    ledger = snapshot.get('ledger', [])
    indexes = {row.get('name') for row in snapshot.get('indexes', [])}
    if (len(column) != 1 or column[0].get('type') != 'varchar' or column[0].get('nullable') != 'YES'
            or indexes != {'ix_sx_retail_orders_created', 'ix_sx_retail_orders_email'}
            or len(ledger) != 1 or ledger[0].get('status') != 'applied'
            or ledger[0].get('checksum') != expected_hash
            or int(ledger[0].get('statements_completed') or 0) != 1
            or int(ledger[0].get('statement_count') or 0) != 1):
        raise RuntimeError('Retail order email schema does not match the reviewed migration')


def prepare(app, files, env_files, workdir, stage_dir, commit, staged, state):
    if (len(files) != EXPECTED_COMPOSE_FILES or len(env_files) != EXPECTED_ENV_FILES
            or files[-1] != LATEST_OVERLAY or len(app['Mounts']) != EXPECTED_MOUNTS
            or app['Image'] != IMAGE):
        raise RuntimeError('Active app release chain differs from the reviewed production baseline')
    if not all(Path(name).is_file() for name in files + env_files):
        raise RuntimeError('An active Compose input is missing')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space for a protected release snapshot')

    release = ROOT / 'releases' / f'retail-orders-workspace-{commit[:12]}-20261107'
    backup = ROOT / 'shared' / f'rollback-retail-orders-workspace-{commit[:12]}-20261107'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    release.chmod(0o755)
    backup.mkdir(mode=0o700)
    backup.chmod(0o700)
    write_json(backup / 'app-before.json', app)
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'source-commit.txt').write_text(commit + '\n')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    write_json(backup / 'compose-input-hashes.json', input_hashes)
    shutil.copytree(stage_dir, release / 'source-snapshot')
    for path in (release / 'source-snapshot').rglob('*'):
        if path.is_file():
            path.chmod(0o644)

    manual = json.loads(PRIOR_VARS.read_text()) if PRIOR_VARS.is_file() else {}
    supplied = {key for name in env_files for key in re.findall(
        r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in files for key in re.findall(
        r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live_env:
            variables[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable')
    write_json(backup / 'compose-vars.json', variables)
    env = dict(os.environ, **variables)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    runtime.chmod(0o755)
    for name, expected_hash in OLD_HASHES.items():
        target = '/app/' + name
        actual = run('docker', 'exec', APP, 'sha256sum', target).split()[0]
        if actual != expected_hash:
            raise RuntimeError('Live Retail source changed since review: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        saved.chmod(0o600)
        if sha(saved.read_bytes()) != actual:
            raise RuntimeError('Protected source preimage hash mismatch: ' + name)
    changed = {}
    for name in MOUNT_FILES:
        target = '/app/' + name
        data = staged[name]
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        parent = output.parent
        while parent == runtime or runtime in parent.parents:
            parent.chmod(0o755)
            if parent == runtime:
                break
            parent = parent.parent
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    old_migration = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e',
                                     '/app/database/migrations/' + MIGRATION], capture_output=True)
    if old_migration.returncode != 0:
        raise RuntimeError('Retail email migration path already exists in the active image')
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.retail-orders-workspace.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    helper = release / 'source-snapshot' / 'deploy/retail-orders-workspace-release.py'
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'overlay-path.txt').write_text(str(overlay) + '\n')

    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    old_app, new_app = before['services']['app'], after['services']['app']
    old_volumes = {row['target']: row for row in old_app['volumes']}
    new_volumes = {row['target']: row for row in new_app['volumes']}
    expected = old_volumes.copy()
    expected.update({row['target']: row for row in mounts})
    if set(new_volumes) != set(expected):
        raise RuntimeError('Candidate app has unexpected mount targets')
    replacements = {row['target'] for row in mounts}
    for target, row in new_volumes.items():
        want = expected[target]
        if (row.get('type'), row.get('source'), row.get('read_only')) != (
                want.get('type'), want.get('source'), want.get('read_only')):
            raise RuntimeError('Candidate app mount changed unexpectedly: ' + target)
        if target in replacements:
            bind = row.get('bind') or {}
            if (set(bind) - {'create_host_path', 'propagation'} or bind.get('create_host_path', False)
                    or bind.get('propagation', 'rprivate') != 'rprivate'):
                raise RuntimeError('Candidate app bind options are not read-only and confined')
        elif row != old_volumes[target]:
            raise RuntimeError('An unrelated app mount changed: ' + target)
    old_app.pop('volumes')
    new_app.pop('volumes')
    if before != after:
        raise RuntimeError('Candidate Compose changes more than the reviewed app mounts')

    services = {name: inspect(name)['Id'] for name in SUPPORT}
    write_json(backup / 'support-services.json', services)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Active Compose input changed during release preparation')
    if inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app changed during release preparation')

    for name, data in changed.items():
        if name.endswith('.js'):
            run('docker', 'run', '--rm', '--network', 'none', '-v',
                str(runtime / name) + ':/verify.js:ro', '--entrypoint', 'node', IMAGE, '--check', '/verify.js')

    migration = staged['database/migrations/' + MIGRATION]
    before_schema = database_snapshot()
    if before_schema['columns'] or before_schema['indexes'] or before_schema['ledger']:
        raise RuntimeError('Retail email schema changed since the read-only preflight')
    write_json(backup / 'retail-schema.before.json', before_schema)
    state['migrationAttempted'] = True
    migration_result = apply_migration(migration)
    state['migrationApplied'] = True
    after_schema = database_snapshot()
    verify_migration(after_schema, sha(migration))
    if migration_result != {'applied': [MIGRATION], 'skipped': []}:
        raise RuntimeError('Retail email migration runner returned an unexpected result')
    write_json(backup / 'retail-migration-result.json', migration_result)
    write_json(backup / 'retail-schema.after.json', after_schema)
    return release, backup, runtime, changed, overlay, common, candidate, env, services, expected


def verify_preimages(backup):
    for name, digest in OLD_HASHES.items():
        local = backup / 'preimages' / name
        if not local.is_file() or sha(local.read_bytes()) != digest:
            raise RuntimeError('Rollback source preimage is missing or altered: ' + name)


def deploy(stage_dir, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit) or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release or source commit differs from the reviewed baseline')
    staged = validate_stage(stage_dir, commit)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    state = {'migrationAttempted': False, 'migrationApplied': False}
    try:
        release, backup, runtime, changed, overlay, common, candidate, env, services, expected = prepare(
            app, files, env_files, workdir, stage_dir, commit, staged, state)
    except Exception:
        if not state['migrationAttempted'] and inspect(APP)['Id'] == app['Id']:
            candidate_backup = ROOT / 'shared' / f'rollback-retail-orders-workspace-{commit[:12]}-20261107'
            candidate_release = ROOT / 'releases' / f'retail-orders-workspace-{commit[:12]}-20261107'
            shutil.rmtree(candidate_release, ignore_errors=True)
            shutil.rmtree(candidate_backup, ignore_errors=True)
        raise

    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if (current['Image'] != app['Image'] or
                current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)])):
            raise RuntimeError('App image or active Compose chain changed unexpectedly')
        if len(current['Mounts']) != len(expected):
            raise RuntimeError('Unexpected app mount count after release')
        for name, identity in services.items():
            if inspect(name)['Id'] != identity:
                raise RuntimeError('A supporting service changed during this app-only release')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime source hash mismatch: ' + name)

        health, _ = http_status('/healthz')
        shell_status, shell = http_status('/user?page=retail-orders')
        api_status, _ = http_status('/api/workspace/retail/orders/search', 'POST', {})
        if health != 200 or shell_status != 200 or api_status not in (401, 403):
            raise RuntimeError('Health, business shell or anonymous Retail API boundary check failed')
        for url, name in (
            ('/business-inventory.js?v=20261107-inventory-store1', 'client/public/business-inventory.js'),
            ('/retail-workspace.js?v=20261107-orders-ui1', 'client/public/retail-workspace.js'),
            ('/retail-workspace.css?v=20261107-orders-ui1', 'client/public/retail-workspace.css'),
            ('/tenant-crm-appearance.js?v=20261107-storefront-profile1', 'client/public/tenant-crm-appearance.js'),
            ('/retail-shop.js?v=20261107-orders-email1', 'client/public/retail-shop.js'),
            ('/retail-shop.css', 'client/public/retail-shop.css'),
        ):
            code, body = http_status(url)
            if code != 200 or sha(body) != sha(staged[name]):
                raise RuntimeError('Public Retail asset differs from the reviewed release: ' + name)
        if any(shell.decode('utf-8', 'replace').count(reference) != 1 for reference in CACHE_REFS):
            raise RuntimeError('Business shell does not reference each reviewed Retail screen version once')
        schema = database_snapshot()
        verify_migration(schema, sha(changed['database/migrations/' + MIGRATION]))
        verify_preimages(backup)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'healthz': health, 'retailOrdersShell': shell_status,
                  'anonymousRetailApi': api_status, 'migration': MIGRATION,
                  'migrationStatus': 'applied', 'hashes': {name: sha(data) for name, data in changed.items()}}
        write_json(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception:
        try:
            run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
            prior = wait_healthy()
            if (prior['Image'] != app['Image'] or
                    prior['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files)):
                raise RuntimeError('Automatic app rollback identity mismatch')
            for name, expected_hash in OLD_HASHES.items():
                if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected_hash:
                    raise RuntimeError('Automatic rollback preimage mismatch: ' + name)
        except Exception as rollback_error:
            raise RuntimeError('Retail deploy failed and automatic app rollback needs operator recovery') from rollback_error
        raise


def restore(backup):
    require_lock()
    base = (backup / 'base-release.txt').read_text().strip()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = Path((backup / 'overlay-path.txt').read_text().strip())
    if os.path.realpath(ROOT / 'current') != base:
        raise RuntimeError('Production base release changed')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later release is active; roll it back first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    verify_preimages(backup)
    prior = json.loads((backup / 'app-before.json').read_text())
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    if (current['Image'] != prior['Image'] or
            current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files)):
        raise RuntimeError('Rollback app or Compose identity mismatch')
    for name, digest in OLD_HASHES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
            raise RuntimeError('Rollback preimage mismatch: ' + name)
    absent = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', '/app/database/migrations/' + MIGRATION], capture_output=True)
    if absent.returncode != 0:
        raise RuntimeError('Rollback did not remove the new app migration file mount')
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Supporting service changed during rollback')
    schema = database_snapshot()
    verify_migration(schema, sha((release / 'runtime/database/migrations' / MIGRATION).read_bytes()))
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'additiveMigrationRetained': MIGRATION, 'supportServicesUnchanged': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'stage':
        stage(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: retail-orders-workspace-release.py stage <directory> <commit> | deploy <stage> <commit> | restore <rollback-directory>')
