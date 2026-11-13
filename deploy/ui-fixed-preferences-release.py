"""Guarded app-only overlay for the fixed light theme and expanded sidebar."""
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
ASSETS = {
    'client/public/index.html': None,
    'client/public/training-sidebar.js': 'client/public/training-sidebar.js',
    'client/public/ui-fixed-preferences.js': 'client/public/ui-fixed-preferences.js',
}
SIDEBAR_KEY = '/training-sidebar.js?v=20261113-fixed-sidebar1'
THEME_TAG = '<script src="/ui-fixed-preferences.js?v=20261113-light-only1"></script>'


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


def prepare_html(app):
    source = run('docker', 'exec', APP, 'cat', '/app/client/public/index.html')
    if source.count('/training-sidebar.js?v=') != 1:
        raise RuntimeError('Expected one production sidebar script reference')
    if '/ui-fixed-preferences.js?' in source:
        raise RuntimeError('Fixed-preferences script is already referenced')
    if source.count('</head>') != 1:
        raise RuntimeError('Unexpected production shell structure')
    html = re.sub(r'/training-sidebar\.js\?v=[^"\']+', SIDEBAR_KEY, source, count=1)
    html = re.sub(r'(<head(?:\s[^>]*)?>)', r'\1' + THEME_TAG, html, count=1, flags=re.I)
    if THEME_TAG not in html or SIDEBAR_KEY not in html:
        raise RuntimeError('Could not patch the production-derived shell')
    return html.encode('utf-8')


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    required = [stage / path for path in ASSETS.values() if path]
    if not all(path.is_file() for path in required):
        raise RuntimeError('Staging directory is missing reviewed JavaScript')

    release = ROOT / 'releases' / f'ui-fixed-preferences-{commit[:12]}-20261113'
    backup = ROOT / 'shared' / f'rollback-ui-fixed-preferences-{commit[:12]}-20261113'
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
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))

    prior_vars_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(prior_vars_path.read_text())
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
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    changed = {}
    for target, source in ASSETS.items():
        live_path = '/app/' + target
        if source is None:
            data = prepare_html(app)
            original = run('docker', 'exec', APP, 'cat', live_path).encode('utf-8')
            saved = preimages / target
            saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_bytes(original)
        else:
            run('docker', 'exec', APP, 'test', '!', '-e', live_path) if target.endswith('ui-fixed-preferences.js') else None
            if source == 'client/public/training-sidebar.js':
                saved = preimages / target
                saved.parent.mkdir(parents=True, exist_ok=True)
                run('docker', 'cp', APP + ':' + live_path, str(saved))
                if not saved.is_file():
                    raise RuntimeError('Could not preserve the live sidebar preimage')
            data = (stage / source).read_bytes()
        output = runtime / target
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[target] = data

    (backup / 'preimage-hashes.json').write_text(json.dumps({p: sha((preimages / p).read_bytes()) for p in ('client/public/index.html', 'client/public/training-sidebar.js')}))
    absent = ['client/public/ui-fixed-preferences.js']
    (backup / 'absent-paths.txt').write_text('\n'.join(absent) + '\n')
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.ui-fixed-preferences.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    before_app, after_app = copy.deepcopy(before['services']['app']), copy.deepcopy(after['services']['app'])
    before_app.pop('volumes')
    after_app.pop('volumes')
    if before_app != after_app:
        raise RuntimeError('Candidate changes non-mount app configuration')
    if {key: value for key, value in before['services'].items() if key != 'app'} != {key: value for key, value in after['services'].items() if key != 'app'}:
        raise RuntimeError('Candidate changes other Compose services')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    helper = release / 'deploy/ui-fixed-preferences-release.py'
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'hashes': {name: sha(data) for name, data in changed.items()}}
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
    overlay = release / 'compose.ui-fixed-preferences.json'
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
    for target in ('client/public/index.html', 'client/public/training-sidebar.js'):
        expected = json.loads((backup / 'preimage-hashes.json').read_text())[target]
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + target).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + target)
    for target in (backup / 'absent-paths.txt').read_text().splitlines():
        run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + target)
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
        raise SystemExit('Usage: ui-fixed-preferences-release.py deploy <stage> <commit> | restore <backup>')
