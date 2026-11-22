"""Guarded app-only release for Pro Catalyst conversation and contact quality."""
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
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
BASE_HASHES = {'modules/platform/chatbot-conversation-control.js': '4fc177b80479aebaf7a82a62a89ea56003e95795ed243316933817f7b461fbe9'}
ASSETS = tuple(BASE_HASHES)
NEW_ASSETS = ()
GREETING = {
    'en': 'Hi! 👋 I’m Pro Catalyst Training Center’s virtual assistant. I can help you explore our courses and answer your questions.',
    'ar': 'مرحبًا! 👋 أنا المساعد الافتراضي لمركز برو كاتاليست للتدريب. يمكنني مساعدتك في استكشاف دوراتنا والإجابة عن أسئلتك.',
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


def db_query(sql, params=None, result='rows'):
    script = """(async()=>{
      const mysql=require('/app/node_modules/mysql2/promise');
      const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4'});
      try { const [r]=await db.query(%s,%s); process.stdout.write(JSON.stringify(%s)); }
      finally { await db.end(); }
    })().catch(e=>{process.stderr.write(String(e.code||'DB_OPERATION_FAILED'));process.exit(1)});""" % (
        json.dumps(sql), json.dumps(params or []), 'r' if result == 'rows' else '{ affectedRows:r.affectedRows }')
    completed = run('docker', 'exec', APP, 'node', '-e', script)
    return json.loads(completed.stdout.strip().splitlines()[-1])


def read_greeting():
    rows = db_query("""SELECT JSON_CONTAINS_PATH(config,'one','$.guidedContent.messages.greeting') AS greetingExists,
      JSON_UNQUOTE(JSON_EXTRACT(config,'$.guidedContent.messages.greeting.en')) AS en,
      JSON_UNQUOTE(JSON_EXTRACT(config,'$.guidedContent.messages.greeting.ar')) AS ar,
      JSON_UNQUOTE(JSON_EXTRACT(config,'$.staffWhatsAppRelayEnabled')) AS relayEnabled,
      JSON_UNQUOTE(JSON_EXTRACT(config,'$.shortHandoffCodesEnabled')) AS shortCodesEnabled
      FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? AND status='live' AND engine='hybrid' LIMIT 2""",
      [TENANT_ID, PROFILE_ID])
    if len(rows) != 1:
        raise RuntimeError('target live Hybrid profile was not found uniquely')
    state = rows[0]
    if not isinstance(state.get('en'), str) or not isinstance(state.get('ar'), str):
        raise RuntimeError('profile greeting is not a localized English/Arabic object')
    if str(state.get('relayEnabled', '')).lower() != 'true' or str(state.get('shortCodesEnabled', '')).lower() != 'true':
        raise RuntimeError('Pro Catalyst relay settings changed; refusing profile update')
    return state


def set_greeting(previous, values):
    sql = """UPDATE sx_chatbot_profiles SET config=JSON_SET(config,
      '$.guidedContent.messages.greeting.en',?,
      '$.guidedContent.messages.greeting.ar',?),revision=revision+1
      WHERE tenant_id=? AND id=? AND status='live' AND engine='hybrid'
        AND JSON_UNQUOTE(JSON_EXTRACT(config,'$.guidedContent.messages.greeting.en')) <=> ?
        AND JSON_UNQUOTE(JSON_EXTRACT(config,'$.guidedContent.messages.greeting.ar')) <=> ?"""
    result = db_query(sql, [values['en'], values['ar'], TENANT_ID, PROFILE_ID, previous['en'], previous['ar']], 'result')
    if result.get('affectedRows') != 1:
        raise RuntimeError('profile greeting changed during deploy; update was not applied')


def restore_greeting(previous, expected_current):
    if int(previous.get('greetingExists') or 0) == 1:
        expression = "JSON_SET(config,'$.guidedContent.messages.greeting.en',?,'$.guidedContent.messages.greeting.ar',?)"
        params = [previous['en'], previous['ar']]
    else:
        expression = "JSON_REMOVE(config,'$.guidedContent.messages.greeting')"
        params = []
    sql = f"""UPDATE sx_chatbot_profiles SET config={expression},revision=revision+1
      WHERE tenant_id=? AND id=? AND status='live' AND engine='hybrid'
        AND JSON_UNQUOTE(JSON_EXTRACT(config,'$.guidedContent.messages.greeting.en')) <=> ?
        AND JSON_UNQUOTE(JSON_EXTRACT(config,'$.guidedContent.messages.greeting.ar')) <=> ?"""
    result = db_query(sql, params + [TENANT_ID, PROFILE_ID, expected_current['en'], expected_current['ar']], 'result')
    if result.get('affectedRows') != 1:
        raise RuntimeError('profile greeting has changed since release; guarded restore refused')


def load_compose_vars(files, env_files, app, backup):
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
    return dict(os.environ, **variables)


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('invalid source commit')
    if not stage.is_dir() or not all((stage / asset).is_file() for asset in (*ASSETS, *NEW_ASSETS)):
        raise RuntimeError('staging directory is missing reviewed runtime assets')
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('active app health or image differs from reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not all(Path(path).is_file() for path in files + env_files):
        raise RuntimeError('active Compose inputs are incomplete')

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'pro-catalyst-conversation-quality-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-pro-catalyst-conversation-quality-{commit[:12]}-{stamp}'
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
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))
    env = load_compose_vars(files, env_files, app, backup)
    previous_greeting = read_greeting()
    (backup / 'profile-greeting.before.json').write_text(json.dumps(previous_greeting, ensure_ascii=False))

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    changed = {}
    prior_hashes = {}
    expected_hashes = {}
    for target in ASSETS:
        live_path = '/app/' + target
        saved = preimages / target
        saved.parent.mkdir(parents=True, exist_ok=True)
        if run('docker', 'exec', APP, 'test', '-f', live_path, check=False).returncode:
            raise RuntimeError('expected live runtime file is missing: ' + target)
        run('docker', 'cp', f'{APP}:{live_path}', str(saved))
        original = saved.read_bytes()
        original_hash = run('docker', 'exec', APP, 'sha256sum', live_path).stdout.split()[0]
        if sha(original) != original_hash or original_hash != BASE_HASHES[target]:
            raise RuntimeError('live file changed during rollback snapshot: ' + target)
        data = (stage / target).read_bytes()
        output = runtime / target
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[target] = data
        prior_hashes[target] = original_hash
        expected_hashes[target] = sha(data)
    for target in NEW_ASSETS:
        live_path = '/app/' + target
        if run('docker', 'exec', APP, 'test', '!', '-e', live_path, check=False).returncode:
            raise RuntimeError('new runtime file already exists: ' + target)
        data = (stage / target).read_bytes()
        output = runtime / target
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[target] = data
        expected_hashes[target] = sha(data)
    (backup / 'preimage-hashes.json').write_text(json.dumps(prior_hashes, indent=2) + '\n')
    (release / 'runtime-hashes.json').write_text(json.dumps(expected_hashes, indent=2) + '\n')

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.pro-catalyst-conversation-quality.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env).stdout)
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env).stdout)
    expected_volumes = {volume['target']: volume for volume in before['services']['app']['volumes']}
    actual_volumes = {volume['target']: volume for volume in after['services']['app']['volumes']}
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
        raise RuntimeError('candidate changes another Compose service')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    deploy_dir = release / 'deploy'
    deploy_dir.mkdir(mode=0o755)
    helper = deploy_dir / Path(__file__).name
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, indent=2) + '\n')

    if any(sha(Path(path).read_bytes()) != digest for path, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('running app or Compose inputs changed during release preparation')
    greeting_updated = False
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
        if greeting_updated:
            set_greeting(previous_greeting, GREETING)
        (backup / 'profile-greeting-updated.json').write_text(json.dumps(greeting_updated) + '\n')
        final_greeting = read_greeting()
        if final_greeting != previous_greeting:
            raise RuntimeError('localized virtual-assistant greeting did not read back')
        health = run('python3', '-c', "import urllib.request; r=urllib.request.urlopen('https://crm.salemax.qa/healthz',timeout=20); print(r.status)").stdout.strip()
        if health != '200':
            raise RuntimeError('public health check did not return HTTP 200')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'supportServicesUnchanged': True, 'profileGreetingUpdated': greeting_updated,
                  'relayEnabled': final_greeting['relayEnabled'], 'shortCodesEnabled': final_greeting['shortCodesEnabled'],
                  'healthz': 'HTTP 200', 'hashes': expected_hashes}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception as failure:
        greeting_restore_error = None
        if greeting_updated:
            try:
                restore_greeting(previous_greeting, GREETING)
            except Exception as error:
                greeting_restore_error = error
        active = inspect(APP)
        if str(overlay) in active['Config']['Labels'].get('com.docker.compose.project.config_files', ''):
            run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env, check=False)
            wait_healthy()
        if greeting_restore_error:
            raise RuntimeError('app rollback completed or was attempted, but profile greeting restoration needs review') from greeting_restore_error
        raise failure


def restore(backup):
    require_lock()
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.pro-catalyst-conversation-quality.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('a later app release is active; restore it first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('rollback Compose input changed')
    for name, digest in json.loads((release / 'runtime-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).stdout.split()[0] != digest:
            raise RuntimeError('active runtime file changed; refusing rollback: ' + name)
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    prior_app = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior_app['Image']:
        raise RuntimeError('rollback app image mismatch')
    for name, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).stdout.split()[0] != digest:
            raise RuntimeError('rollback file hash mismatch: ' + name)
    previous_greeting = json.loads((backup / 'profile-greeting.before.json').read_text())
    if json.loads((backup / 'profile-greeting-updated.json').read_text()):
        restore_greeting(previous_greeting, GREETING)
    for name in NEW_ASSETS:
        if run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name, check=False).returncode:
            raise RuntimeError('new runtime file remains after rollback: ' + name)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'profileGreetingRestored': json.loads((backup / 'profile-greeting-updated.json').read_text()),
                      'supportServicesUnchanged': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: pro-catalyst-conversation-quality-release.py deploy <stage> <commit> | restore <backup>')
