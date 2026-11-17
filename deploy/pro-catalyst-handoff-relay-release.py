"""Guarded app-only Pro Catalyst text handoff relay release."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
TENANT_ID = '2301ea04-8acd-493e-a582-b9e527294005'
PROFILE_ID = '51f11d68-1b77-4d73-9d28-96e36a80631f'
MIGRATION = '20270205_chatbot_handoff_whatsapp_relay.sql'
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
ASSETS = {
    'automation/functions.js': 'automation/functions.js',
    'database/migrations/' + MIGRATION: 'database/migrations/' + MIGRATION,
    'helper/inbox/inbox.js': 'helper/inbox/inbox.js',
    'helper/addon/qr/processThings.js': 'helper/addon/qr/processThings.js',
    'helper/socket/function.js': 'helper/socket/function.js',
    'modules/platform/chatbot-business-context.js': 'modules/platform/chatbot-business-context.js',
    'modules/platform/chatbot-conversation-control.js': 'modules/platform/chatbot-conversation-control.js',
    'modules/platform/chatbot-handoff-claims.js': 'modules/platform/chatbot-handoff-claims.js',
    'modules/platform/chatbot-handoff-relay.js': 'modules/platform/chatbot-handoff-relay.js',
    'modules/platform/chatbot-runtime.js': 'modules/platform/chatbot-runtime.js',
    'modules/platform/mount-existing-upgrade.js': 'modules/platform/mount-existing-upgrade.js',
}


def run(*args, env=None, check=True):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError(f'command failed: {Path(args[0]).name}')
    return result


def inspect(name):
    return json.loads(run('docker', 'inspect', name).stdout)[0]


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
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('app health did not recover')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('protected production lock required')
    if run('hostname').stdout.strip() != 'carsqatar-prod-01':
        raise RuntimeError('unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('active base release changed')


def node_json(source):
    result = run('docker', 'exec', APP, 'node', '-e', source)
    try:
        return json.loads(result.stdout.strip().splitlines()[-1])
    except Exception as exc:
        raise RuntimeError('production database operation returned an invalid result') from exc


def db_query_source(sql, params=None, mode='rows'):
    return """(async()=>{
      const mysql=require('/app/node_modules/mysql2/promise');
      const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4'});
      try { const [r]=await db.query(%s,%s); process.stdout.write(JSON.stringify(%s)); }
      finally { await db.end(); }
    })().catch(e=>{process.stderr.write(String(e.code||'DB_OPERATION_FAILED'));process.exit(1)});""" % (
        json.dumps(sql), json.dumps(params or []), 'r' if mode == 'rows' else '{ affectedRows:r.affectedRows }')


def migration_source(filename):
    return """(async()=>{
      const mysql=require('/app/node_modules/mysql2/promise');
      const runner=require('/app/database/migration-runner');
      const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4',multipleStatements:false});
      try { const all=runner.discover('/app/database/migrations'); const result=await runner.applyMigrations(db,all,{only:%s}); process.stdout.write(JSON.stringify(result)); }
      finally { await db.end(); }
    })().catch(e=>{process.stderr.write(String(e.code||'MIGRATION_FAILED'));process.exit(1)});""" % json.dumps(filename)


def profile_flag():
    return node_json(db_query_source("SELECT JSON_TYPE(JSON_EXTRACT(config,'$.staffWhatsAppRelayEnabled')) AS kind,JSON_UNQUOTE(JSON_EXTRACT(config,'$.staffWhatsAppRelayEnabled')) AS value FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? AND status='live' AND engine='hybrid' LIMIT 2", [TENANT_ID, PROFILE_ID]))


def flag_is_enabled(state):
    if state.get('kind') not in ('BOOLEAN', 'TRUE', 'FALSE'):
        return False
    return str(state.get('value', '')).lower() == 'true'


def set_profile_flag(enabled):
    expression = "JSON_SET(config,'$.staffWhatsAppRelayEnabled',true)" if enabled else "JSON_REMOVE(config,'$.staffWhatsAppRelayEnabled')"
    result = node_json(db_query_source(f"UPDATE sx_chatbot_profiles SET config={expression},revision=revision+1 WHERE tenant_id=? AND id=? AND status='live' AND engine='hybrid'", [TENANT_ID, PROFILE_ID], mode='result'))
    if result.get('affectedRows') != 1:
        raise RuntimeError('target hybrid profile flag update did not affect exactly one row')


def restore_profile_flag(kind, value):
    if kind in (None, 'NULL'):
        set_profile_flag(False)
        return
    if kind in ('BOOLEAN', 'TRUE', 'FALSE') and str(value).lower() in ('true', 'false'):
        enabled = str(value).lower() == 'true'
        expression = 'true' if enabled else 'false'
        node_json(db_query_source(f"UPDATE sx_chatbot_profiles SET config=JSON_SET(config,'$.staffWhatsAppRelayEnabled',{expression}),revision=revision+1 WHERE tenant_id=? AND id=?", [TENANT_ID, PROFILE_ID], mode='result'))
        return
    raise RuntimeError('profile relay flag has an unexpected prior value; refusing rollback')


def apply_migration(stage, expected_checksum):
    source = stage / ('database/migrations/' + MIGRATION)
    if sha(source.read_bytes()) != expected_checksum:
        raise RuntimeError('staged migration hash changed')
    run('docker', 'cp', str(source), f'{APP}:/app/database/migrations/{MIGRATION}')
    node_json(migration_source(MIGRATION))
    rows = node_json(db_query_source('SELECT migration_name,status,checksum FROM salemax_schema_migrations WHERE migration_name=? LIMIT 2', [MIGRATION]))
    if len(rows) != 1 or rows[0].get('status') != 'applied' or rows[0].get('checksum') != expected_checksum:
        raise RuntimeError('relay migration checksum/status verification failed')
    schema = node_json(db_query_source("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='sx_chatbot_handoff_relay_deliveries'"))
    if len(schema) != 1 or int(schema[0].get('n', 0)) != 1:
        raise RuntimeError('relay outbox table is missing after migration')


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('invalid source commit')
    if not stage.is_dir() or not all((stage / source).is_file() for source in ASSETS.values()):
        raise RuntimeError('staging directory is missing reviewed assets')
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('active app health or image differs from reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('active Compose inputs are incomplete')

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'pro-catalyst-handoff-relay-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-pro-catalyst-handoff-relay-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'profile-flag.before.json').write_text(json.dumps(profile_flag()))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))

    manual = json.loads((ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json').read_text())
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
            raise RuntimeError('missing Compose interpolation variable')
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    env = dict(os.environ, **variables)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    changed = {}
    expected_hashes = {}
    for target, source in ASSETS.items():
        live_path = '/app/' + target
        saved = preimages / target
        saved.parent.mkdir(parents=True, exist_ok=True)
        exists = run('docker', 'exec', APP, 'test', '-f', live_path, check=False).returncode == 0
        if exists:
            run('docker', 'cp', f'{APP}:{live_path}', str(saved))
            original = saved.read_bytes()
            actual_hash = run('docker', 'exec', APP, 'sha256sum', live_path).stdout.split()[0]
            if sha(original) != actual_hash:
                raise RuntimeError('live preimage changed during capture: ' + target)
            (backup / ('preimage-present-' + sha(target.encode())[:12])).write_text('yes')
        else:
            (backup / ('preimage-present-' + sha(target.encode())[:12])).write_text('no')
        data = (stage / source).read_bytes()
        output = runtime / target
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[target] = data
        expected_hashes[target] = sha(data)
    (backup / 'preimage-hashes.json').write_text(json.dumps({p: sha((preimages / p).read_bytes()) for p in changed if (preimages / p).is_file()}))
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.pro-catalyst-handoff-relay.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env).stdout)
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env).stdout)
    expected_volumes = {v['target']: v for v in before['services']['app']['volumes']}
    actual_volumes = {v['target']: v for v in after['services']['app']['volumes']}
    for mount in mounts:
        target = mount['target']
        actual = actual_volumes.pop(target, {})
        expected_volumes.pop(target, None)
        if any(actual.get(key) != mount[key] for key in ('type', 'source', 'read_only')):
            raise RuntimeError('candidate is missing the reviewed read-only bind: ' + target)
    if actual_volumes != expected_volumes:
        raise RuntimeError('candidate changes unexpected app mounts')
    before_app, after_app = copy.deepcopy(before['services']['app']), copy.deepcopy(after['services']['app'])
    before_app.pop('volumes')
    after_app.pop('volumes')
    if before_app != after_app:
        raise RuntimeError('candidate changes non-mount app configuration')
    if {key: value for key, value in before['services'].items() if key != 'app'} != {key: value for key, value in after['services'].items() if key != 'app'}:
        raise RuntimeError('candidate changes other Compose services')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    helper = release / 'deploy'
    helper.mkdir(mode=0o755)
    (helper / Path(__file__).name).write_bytes(Path(__file__).read_bytes())
    (helper / Path(__file__).name).chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('running app or Compose inputs changed during preparation')
    migration_hash = expected_hashes['database/migrations/' + MIGRATION]
    apply_migration(stage, migration_hash)
    (backup / 'migration.json').write_text(json.dumps({'name': MIGRATION, 'checksum': migration_hash, 'status': 'applied'}))
    enabled = False
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('app image or Compose chain changed')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).stdout.split()[0] != sha(data):
                raise RuntimeError('runtime file hash mismatch: ' + name)
        state = profile_flag()
        if len(state) != 1:
            raise RuntimeError('target profile was not found uniquely')
        prior = state[0]
        if prior.get('kind') in (None, 'NULL'):
            set_profile_flag(True)
            enabled = True
        elif prior.get('kind') in ('BOOLEAN', 'TRUE', 'FALSE') and str(prior.get('value', '')).lower() == 'false':
            set_profile_flag(True)
            enabled = True
        elif not flag_is_enabled(prior):
            raise RuntimeError('profile relay flag has an unexpected value')
        final = profile_flag()
        if len(final) != 1 or not flag_is_enabled(final[0]):
            raise RuntimeError('profile relay flag did not become true')
        health = run('python3', '-c', "import urllib.request; r=urllib.request.urlopen('https://crm.salemax.qa/healthz',timeout=20); print(r.status)").stdout.strip()
        if health != '200':
            raise RuntimeError('public health check did not return HTTP 200')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'supportServicesUnchanged': True, 'migration': MIGRATION,
                  'profileFlagEnabled': True, 'healthz': 'HTTP 200',
                  'hashes': expected_hashes}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        if enabled:
            restore_profile_flag(*_flag_state(backup))
        active = inspect(APP)
        if str(overlay) in active['Config']['Labels'].get('com.docker.compose.project.config_files', ''):
            run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env, check=False)
            wait_healthy()
        raise


def _flag_state(backup):
    value = json.loads((backup / 'profile-flag.before.json').read_text())
    if len(value) != 1:
        raise RuntimeError('invalid saved profile flag')
    return value[0].get('kind'), value[0].get('value')


def restore(backup):
    require_lock()
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.pro-catalyst-handoff-relay.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('a later release is active; roll it back first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('rollback Compose input changed')
    restore_profile_flag(*_flag_state(backup))
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['Image']:
        raise RuntimeError('rollback app image mismatch')
    for name, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).stdout.split()[0] != digest:
            raise RuntimeError('rollback file hash mismatch: ' + name)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True, 'supportServicesUnchanged': True,
                      'migrationRetained': MIGRATION}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: pro-catalyst-handoff-relay-release.py deploy <stage> <commit> | restore <backup>')
