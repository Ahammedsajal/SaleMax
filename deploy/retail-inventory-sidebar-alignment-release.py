"""Guarded app-only release for aligning the Retail & Inventory sidebar row."""
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
LATEST_OVERLAY = '/opt/salemax/releases/retail-inventory-sidebar-6347443b352c-20261107/compose.retail-inventory-sidebar.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
EXPECTED_COMPOSE_FILES = 151
EXPECTED_ENV_FILES = 11
EXPECTED_MOUNTS = 152
SOURCE_FILES = (
    'client/public/index.html',
    'client/public/training-sidebar.js',
    'client/public/business-inventory.js',
)
OLD_HASHES = {
    'client/public/index.html': '54251c383090292dff0ea3854ae500e33999f8d663ac22086cb67bf5dfb2f751',
    'client/public/training-sidebar.js': 'ffbd8882c768010a5b145e266514f4934f1d5d832adb8fcbeb983cfb8ec9edfb',
    'client/public/business-inventory.js': '72a9d5879ebb2ce03c0fc0b21e740feb544a93c35fd226621b8ff550cd2cfc10',
}
CACHE_KEYS = {
    'training-sidebar.js?v=20261107-retail-nav2': 'training-sidebar.js?v=20261107-retail-nav3',
    'business-inventory.js?v=20261107-inventory-nav2': 'business-inventory.js?v=20261107-inventory-nav3',
}
SUPPORT = (
    'salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
    'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db',
)


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


def validate_stage(stage, commit):
    manifest = json.loads((stage / 'source-manifest.json').read_text())
    if manifest.get('sourceCommit') != commit:
        raise RuntimeError('Staged source commit differs from release commit')
    changed = {}
    for name in SOURCE_FILES:
        data = (stage / name).read_bytes()
        if manifest.get('files', {}).get(name) != sha(data):
            raise RuntimeError('Staged source hash mismatch: ' + name)
        changed[name] = data
    html = changed['client/public/index.html'].decode('utf-8')
    for old, new in CACHE_KEYS.items():
        if old in html or html.count(new) != 1:
            raise RuntimeError('Sidebar cache references differ from the reviewed release')
    return changed


def prepare_compose(app, files, env_files, workdir, stage, commit, release, backup):
    if (len(files) != EXPECTED_COMPOSE_FILES or len(env_files) != EXPECTED_ENV_FILES
            or files[-1] != LATEST_OVERLAY or len(app['Mounts']) != EXPECTED_MOUNTS
            or app['Image'] != IMAGE):
        raise RuntimeError('Active app release chain differs from the reviewed baseline')
    if not all(Path(name).is_file() for name in files + env_files):
        raise RuntimeError('An active Compose input is missing')

    os.umask(0o077)
    release.mkdir(mode=0o755)
    release.chmod(0o755)
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
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    env = dict(os.environ, **variables)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    runtime.chmod(0o755)
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
        directory = output.parent
        while directory == runtime or runtime in directory.parents:
            directory.chmod(0o755)
            if directory == runtime:
                break
            directory = directory.parent
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.retail-inventory-sidebar-alignment.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    old_app, new_app = before['services']['app'], after['services']['app']
    old_volumes = {row['target']: row for row in old_app['volumes']}
    new_volumes = {row['target']: row for row in new_app['volumes']}
    expected_volumes = dict(old_volumes, **{row['target']: row for row in mounts})
    if set(new_volumes) != set(expected_volumes):
        raise RuntimeError('Unexpected candidate mount targets')
    replaced = {row['target']: row for row in mounts}
    for target, row in new_volumes.items():
        expected = expected_volumes[target]
        if (row['type'], row.get('source'), row.get('read_only')) != (
                expected['type'], expected.get('source'), expected.get('read_only')):
            raise RuntimeError('Unexpected candidate mount: ' + target)
        if target in replaced:
            bind = row.get('bind') or {}
            bind_is_safe = (isinstance(bind, dict)
                            and not (set(bind) - {'create_host_path', 'propagation'})
                            and bind.get('create_host_path', False) is False
                            and bind.get('propagation', 'rprivate') == 'rprivate')
            if not bind_is_safe:
                raise RuntimeError('Unexpected bind options: ' + target)
        elif row != old_volumes[target]:
            raise RuntimeError('Unrelated app mount changed: ' + target)
    old_app.pop('volumes')
    new_app.pop('volumes')
    if before != after:
        raise RuntimeError('Candidate changes non-mount Compose configuration')

    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    release_helper = release / 'deploy' / Path(__file__).name
    release_helper.parent.mkdir(mode=0o755)
    release_helper.parent.chmod(0o755)
    release_helper.write_bytes(Path(__file__).read_bytes())
    release_helper.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')

    for name, data in changed.items():
        if name.endswith('.js'):
            run('docker', 'run', '--rm', '--network', 'none', '-v',
                str(runtime / name) + ':/verify.js:ro', '--entrypoint', 'node', IMAGE, '--check', '/verify.js')
    return backup, changed, release, runtime, common, candidate, env, services, len(old_volumes), overlay


def deploy(stage, commit):
    require_lock()
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    validate_stage(stage, commit)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space for a release snapshot')

    release = ROOT / 'releases' / f'retail-inventory-sidebar-alignment-{commit[:12]}-20261107'
    backup = ROOT / 'shared' / f'rollback-retail-inventory-sidebar-alignment-{commit[:12]}-20261107'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    try:
        backup, changed, release, runtime, common, candidate, env, services, mount_count, overlay = prepare_compose(
            app, files, env_files, workdir, stage, commit, release, backup)
    except Exception:
        if inspect(APP)['Id'] == app['Id']:
            shutil.rmtree(release, ignore_errors=True)
            shutil.rmtree(backup, ignore_errors=True)
        raise

    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if (current['Image'] != app['Image'] or
                current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)])):
            raise RuntimeError('App image or active Compose chain changed unexpectedly')
        if len(current['Mounts']) != mount_count:
            raise RuntimeError('Unexpected app mount count after release')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)

        health, _ = http_status('/healthz')
        shell_status, shell = http_status('/user')
        api_status, _ = http_status('/api/workspace/business-inventory?offset=0')
        if health != 200 or shell_status != 200 or api_status not in (401, 403):
            raise RuntimeError('Health, business shell, or anonymous inventory API check failed')
        for path, name in (
            ('/training-sidebar.js?v=20261107-retail-nav3', 'client/public/training-sidebar.js'),
            ('/business-inventory.js?v=20261107-inventory-nav3', 'client/public/business-inventory.js'),
        ):
            code, body = http_status(path)
            if code != 200 or sha(body) != sha(changed[name]):
                raise RuntimeError('Public asset differs from reviewed runtime: ' + name)
        if any(key not in shell.decode('utf-8', 'replace') for key in CACHE_KEYS.values()):
            raise RuntimeError('Business shell does not reference both reviewed cache keys')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'healthz': health, 'businessShell': shell_status,
                  'anonymousInventoryApi': api_status,
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
    overlay = release / 'compose.retail-inventory-sidebar-alignment.json'
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
    if (current['Image'] != prior['Image'] or
            current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files)):
        raise RuntimeError('Rollback app or Compose identity mismatch')
    for name, expected in OLD_HASHES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback preimage mismatch: ' + name)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True, 'supportServicesUnchanged': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: retail-inventory-sidebar-release.py deploy <stage> <commit> | restore <backup>')
