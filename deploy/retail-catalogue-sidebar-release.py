"""Deploy the Retail catalogue/schema and sidebar correction as an app overlay."""
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
LATEST_OVERLAY = '/opt/salemax/releases/website-conversation-story-ef6d9fa8fbf8-20261107/compose.website-conversation-story.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
EXPECTED_COMPOSE_FILES = 148
EXPECTED_ENV_FILES = 11
EXPECTED_MOUNTS = 145
MIGRATION = '20270201_retail_catalogue_schema_compatibility.sql'
SUPPORT = (
    'salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
    'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db',
)
SOURCE_FILES = (
    'client/public/index.html',
    'client/public/training-sidebar.js',
    'client/public/training-courses.js',
    'client/public/retail-workspace.js',
    'modules/platform/training-course-router.js',
    'database/migrations/' + MIGRATION,
)
OLD_HASHES = {
    'client/public/index.html': '15a80d354b391d0d62b261309c8373ffa50cb07b10a347e834d96ca0a3623b67',
    'client/public/training-sidebar.js': '9725c9556c0e8204e2c12be02285b167fb32423c145f422adf4c6943e4e69aae',
    'client/public/training-courses.js': 'ec3801d9f2710041156c9db488d7c6e49659b566aa61c0c97ffe699a32f2318b',
    'client/public/retail-workspace.js': '0e5702de2394d3b86154dba4e44d64904b112b76a467562eff88ab9b4ff6bc94',
    'modules/platform/training-course-router.js': 'b762ceccfffd0fdf1ce28f12035d21c5e83bad33960e69df5ed83c390e90fa41',
}
CACHE_KEYS = {
    'training-courses.js?v=private-inventory1': 'training-courses.js?v=20261107-retail-catalogue1',
    'training-sidebar.js?v=20261104-ai-provider-profiles2': 'training-sidebar.js?v=20261107-retail-catalogue1',
    'retail-workspace.js?v=20261106-shopify-woo-images3': 'retail-workspace.js?v=20261107-retail-sidebar1',
}


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def sha(data):
    return hashlib.sha256(data).hexdigest()


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


def http_status(path):
    try:
        with urllib.request.urlopen('https://7network.live' + path, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.read()


SCHEMA_PROGRAM = r"""
const mysql=require('/app/node_modules/mysql2/promise');
(async()=>{const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});try{const [columns]=await db.query("SELECT COLUMN_NAME AS name,DATA_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_product_catalog' AND COLUMN_NAME IN ('certificate_details_en','certificate_details_ar') ORDER BY COLUMN_NAME");const [ledger]=await db.query('SELECT migration_name,checksum,status,statements_completed,statement_count FROM salemax_schema_migrations WHERE migration_name=?',[""" + json.dumps(MIGRATION) + r"""]);console.log(JSON.stringify({columns,ledger}));}finally{await db.end();}})().catch(error=>{console.error(error.code||'DB_SNAPSHOT_FAILED');process.exitCode=1;});
"""

MIGRATION_PROGRAM = r"""
const fs=require('node:fs'),crypto=require('node:crypto');
const mysql=require('/app/node_modules/mysql2/promise');
const runner=require('/app/database/migration-runner');
(async()=>{const source=fs.readFileSync(0,'utf8');const migrations=runner.discover('/app/database/migrations');migrations.push({file:""" + json.dumps(MIGRATION) + r""",checksum:crypto.createHash('sha256').update(source).digest('hex'),statements:runner.splitSql(source)});const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});try{console.log(JSON.stringify(await runner.applyMigrations(db,migrations,{only:""" + json.dumps(MIGRATION) + r"""})));}finally{await db.end();}})().catch(error=>{console.error('Migration stopped:',error.code||'MIGRATION_FAILED');process.exitCode=1;});
"""


def database_snapshot():
    result = subprocess.run(['docker', 'exec', APP, 'node', '-e', SCHEMA_PROGRAM], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Unable to read catalogue schema metadata')
    return json.loads(result.stdout)


def apply_migration(data):
    result = subprocess.run(['docker', 'exec', '-i', APP, 'node', '-e', MIGRATION_PROGRAM],
                            input=data.decode('utf-8'), capture_output=True, text=True)
    if result.returncode:
        code = re.search(r'Migration stopped: ([A-Z0-9_]+)', result.stderr)
        raise RuntimeError('Catalogue migration failed: ' + (code[1] if code else 'details withheld'))
    return json.loads(result.stdout)


def validate_candidate(stage, commit):
    manifest = json.loads((stage / 'source-manifest.json').read_text())
    if manifest.get('sourceCommit') != commit:
        raise RuntimeError('Staged source commit differs from release commit')
    files = {}
    for name in SOURCE_FILES:
        data = (stage / name).read_bytes()
        if manifest.get('files', {}).get(name) != sha(data):
            raise RuntimeError('Staged source hash mismatch: ' + name)
        files[name] = data
    index = files['client/public/index.html'].decode('utf-8')
    for old, new in CACHE_KEYS.items():
        if old in index or index.count(new) != 1:
            raise RuntimeError('Production shell cache references differ from the reviewed release')
    return manifest, files


def prepare_compose(app, files, env_files, workdir, stage, commit):
    labels = app['Config']['Labels']
    if (len(files) != EXPECTED_COMPOSE_FILES or len(env_files) != EXPECTED_ENV_FILES
            or files[-1] != LATEST_OVERLAY or len(app['Mounts']) != EXPECTED_MOUNTS
            or app['Image'] != IMAGE):
        raise RuntimeError('Active app release chain differs from the reviewed baseline')
    if not all(Path(name).is_file() for name in files + env_files):
        raise RuntimeError('An active Compose input is missing')

    release = ROOT / 'releases' / f'retail-catalogue-sidebar-{commit[:12]}-20261107'
    backup = ROOT / 'shared' / f'rollback-retail-catalogue-sidebar-{commit[:12]}-20261107'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'source-commit.txt').write_text(commit + '\n')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))

    manual = json.loads(PRIOR_VARS.read_text())
    supplied = {key for name in env_files for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in files for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live_env:
            variables[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable')
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    env = dict(os.environ, **variables)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    changed = {}
    for name, expected in OLD_HASHES.items():
        target = '/app/' + name
        actual = run('docker', 'exec', APP, 'sha256sum', target).split()[0]
        if actual != expected:
            raise RuntimeError('Live source changed: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Preimage hash mismatch: ' + name)
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    migration_target = '/app/database/migrations/' + MIGRATION
    absent = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', migration_target], capture_output=True)
    if absent.returncode != 0:
        raise RuntimeError('Catalogue migration already exists in the active image')
    migration = (stage / 'database/migrations' / MIGRATION).read_bytes()
    migration_path = runtime / 'database/migrations' / MIGRATION
    migration_path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    migration_path.write_bytes(migration)
    migration_path.chmod(0o644)
    changed['database/migrations/' + MIGRATION] = migration

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.retail-catalogue-sidebar.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    release_helper = release / 'deploy' / Path(__file__).name
    release_helper.parent.mkdir(mode=0o755)
    release_helper.write_bytes(Path(__file__).read_bytes())
    release_helper.chmod(0o644)

    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    old_app, new_app = before['services']['app'], after['services']['app']
    old_volumes = {row['target']: row for row in old_app['volumes']}
    new_volumes = {row['target']: row for row in new_app['volumes']}
    expected_volumes = old_volumes.copy()
    expected_volumes.update({row['target']: row for row in mounts})
    if set(new_volumes) != set(expected_volumes):
        raise RuntimeError('Unexpected candidate mount targets')
    replacements = {row['target'] for row in mounts}
    for target, row in new_volumes.items():
        expected = expected_volumes[target]
        if target in replacements:
            bind = row.get('bind') or {}
            bind_is_safe = (
                isinstance(bind, dict)
                and not (set(bind) - {'create_host_path', 'propagation'})
                and bind.get('create_host_path', False) is False
                and bind.get('propagation', 'rprivate') == 'rprivate'
            )
            if ((row['type'], row.get('source'), row.get('read_only')) !=
                    (expected['type'], expected.get('source'), expected.get('read_only'))
                    or not bind_is_safe):
                raise RuntimeError('Unexpected candidate mount: ' + target)
        if target not in replacements and row != old_volumes[target]:
            raise RuntimeError('Unrelated app mount changed: ' + target)
    old_app.pop('volumes')
    new_app.pop('volumes')
    if before != after:
        raise RuntimeError('Candidate changes non-mount Compose configuration')
    support = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(support))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')

    for name, data in changed.items():
        if name.endswith('.js'):
            run('docker', 'run', '--rm', '--network', 'none', '-v',
                str(runtime / name) + ':/verify.js:ro', '--entrypoint', 'node', IMAGE, '--check', '/verify.js')

    schema_before = database_snapshot()
    if schema_before['columns'] or schema_before['ledger']:
        raise RuntimeError('Catalogue schema or migration ledger changed since investigation')
    (backup / 'catalogue-schema.before.json').write_text(json.dumps(schema_before))
    migration_result = apply_migration(migration)
    (backup / 'migration-result.json').write_text(json.dumps(migration_result))
    schema_after = database_snapshot()
    names = {row['name'] for row in schema_after['columns']}
    ledger = schema_after['ledger']
    if (names != {'certificate_details_en', 'certificate_details_ar'} or len(ledger) != 1
            or ledger[0]['status'] != 'applied' or ledger[0]['checksum'] != sha(migration)
            or ledger[0]['statements_completed'] != 1 or ledger[0]['statement_count'] != 1
            or migration_result != {'applied': [MIGRATION], 'skipped': []}):
        raise RuntimeError('Catalogue migration result did not match the reviewed schema')
    (backup / 'catalogue-schema.after.json').write_text(json.dumps(schema_after))
    return release, backup, runtime, mounts, changed, overlay, common, candidate, env, support, expected_volumes


def deploy(stage, commit):
    require_lock()
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    validate_candidate(stage, commit)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space for a release snapshot')

    release, backup, runtime, mounts, changed, overlay, common, candidate, env, support, expected_volumes = prepare_compose(
        app, files, env_files, workdir, stage, commit)
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or active Compose chain changed unexpectedly')
        if len(current['Mounts']) != len(expected_volumes):
            raise RuntimeError('Unexpected app mount count after release')
        if any(inspect(name)['Id'] != identity for name, identity in support.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)

        health, _ = http_status('/healthz')
        shell_status, shell = http_status('/user?page=products-services')
        api_status, _ = http_status('/api/workspace/products-services?page=1&limit=50')
        if health != 200 or shell_status != 200 or api_status not in (401, 403):
            raise RuntimeError('Public health, shell, or anonymous product API check failed')
        for cache_url, name in (
            ('/training-sidebar.js?v=20261107-retail-catalogue1', 'client/public/training-sidebar.js'),
            ('/training-courses.js?v=20261107-retail-catalogue1', 'client/public/training-courses.js'),
            ('/retail-workspace.js?v=20261107-retail-sidebar1', 'client/public/retail-workspace.js'),
        ):
            code, body = http_status(cache_url)
            if code != 200 or sha(body) != sha(changed[name]):
                raise RuntimeError('Public asset differs from the reviewed runtime: ' + name)
        if any(key not in shell.decode('utf-8', 'replace') for key in CACHE_KEYS.values()):
            raise RuntimeError('Product shell does not reference all reviewed cache keys')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'healthz': health, 'productShell': shell_status, 'anonymousProductApi': api_status,
                  'migration': MIGRATION, 'migrationStatus': 'applied',
                  'hashes': {name: sha(data) for name, data in changed.items()}}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_lock()
    if os.path.realpath(ROOT / 'current') != (backup / 'base-release.txt').read_text().strip():
        raise RuntimeError('Production base release changed')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.retail-catalogue-sidebar.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later release is active; roll it back first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    prior = json.loads((backup / 'app-before.json').read_text())
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    if current['Image'] != prior['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files):
        raise RuntimeError('Rollback app or Compose identity mismatch')
    for name, expected in OLD_HASHES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback preimage mismatch: ' + name)
    if subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', '/app/database/migrations/' + MIGRATION], capture_output=True).returncode != 0:
        raise RuntimeError('Rollback did not restore the absent migration path')
    if any(inspect(name)['Id'] != identity for name, identity in json.loads((backup / 'support-services.json').read_text()).items()):
        raise RuntimeError('Rollback support service changed')
    schema = database_snapshot()
    if {row['name'] for row in schema['columns']} != {'certificate_details_en', 'certificate_details_ar'}:
        raise RuntimeError('Additive catalogue columns were not retained after app rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'migrationRetained': MIGRATION, 'supportServicesUnchanged': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: retail-catalogue-sidebar-release.py deploy <stage> <commit> | restore <backup>')
