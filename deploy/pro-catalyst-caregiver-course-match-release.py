"""Guarded app-only release for caregiver course phrase matching."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
ASSET = 'modules/platform/chatbot-business-context.js'
BEFORE = '37d6f89bafde523d12533fbce9b8861cee2abd33d3956b6bd66e488971105784'
AFTER = '8dc53cbca0c0f06cb800a8155972d5ca781ce3069a3c369c9981b957e7e9bbb8'


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
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    staged = stage / ASSET
    if not staged.is_file() or sha(staged.read_bytes()) != AFTER:
        raise RuntimeError('Staged asset differs from reviewed source')

    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    release = ROOT / 'releases' / f'pro-catalyst-caregiver-course-match-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-pro-catalyst-caregiver-course-match-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}

    prior_vars_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(prior_vars_path.read_text())
    supplied = {key for name in env_files for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = set()
    for name in files:
        for expression in re.findall(r'\$\{([^}]+)\}', Path(name).read_text()):
            match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)(.*)$', expression)
            if not match:
                continue
            key, operator = match.groups()
            # Optional Compose substitutions resolve from their declared
            # default, so they do not need an unrelated live environment value.
            if operator.startswith((':-', '-', ':+', '+')):
                continue
            referenced.add(key)
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live_env:
            variables[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable: ' + key)
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    env = dict(os.environ, **variables)

    live_path = '/app/' + ASSET
    preimage = backup / 'preimages' / ASSET
    preimage.parent.mkdir(parents=True, exist_ok=True)
    run('docker', 'cp', APP + ':' + live_path, str(preimage))
    original = preimage.read_bytes()
    if sha(original) != BEFORE or sha(original) != run('docker', 'exec', APP, 'sha256sum', live_path).split()[0]:
        raise RuntimeError('Live preimage differs from the reviewed baseline')
    data = staged.read_bytes()
    runtime = release / 'runtime' / ASSET
    runtime.parent.mkdir(parents=True, exist_ok=True)
    runtime.write_bytes(data)
    runtime.chmod(0o644)
    (backup / 'preimage-hashes.json').write_text(json.dumps({ASSET: sha(original)}))

    mount = {'type': 'bind', 'source': str(runtime), 'target': live_path,
             'read_only': True, 'bind': {'create_host_path': False}}
    overlay = release / 'compose.pro-catalyst-caregiver-course-match.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': [mount]}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before_config = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after_config = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    before_volumes = {item['target']: item for item in before_config['services']['app']['volumes']}
    after_volumes = {item['target']: item for item in after_config['services']['app']['volumes']}
    actual = after_volumes.pop(live_path, {})
    before_volumes.pop(live_path, None)
    if any(actual.get(key) != mount[key] for key in ('type', 'source', 'read_only')) or after_volumes != before_volumes:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app, after_app = copy.deepcopy(before_config['services']['app']), copy.deepcopy(after_config['services']['app'])
    before_app.pop('volumes')
    after_app.pop('volumes')
    if before_app != after_app:
        raise RuntimeError('Candidate changes non-mount app configuration')
    if {key: value for key, value in before_config['services'].items() if key != 'app'} != {key: value for key, value in after_config['services'].items() if key != 'app'}:
        raise RuntimeError('Candidate changes another Compose service')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    (release / 'deploy/pro-catalyst-caregiver-course-match-release.py').write_bytes(Path(__file__).read_bytes())
    (release / 'deploy/pro-catalyst-caregiver-course-match-release.py').chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        if run('docker', 'exec', APP, 'sha256sum', live_path).split()[0] != sha(data):
            raise RuntimeError('Runtime asset hash mismatch')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'hashes': {ASSET: sha(data)}}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_lock()
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.pro-catalyst-caregiver-course-match.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later release is active; roll it back first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['Image']:
        raise RuntimeError('Rollback app image mismatch')
    expected = json.loads((backup / 'preimage-hashes.json').read_text())[ASSET]
    if run('docker', 'exec', APP, 'sha256sum', '/app/' + ASSET).split()[0] != expected:
        raise RuntimeError('Rollback asset hash mismatch')
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: pro-catalyst-caregiver-course-match-release.py deploy <stage> <commit> | restore <backup>')
