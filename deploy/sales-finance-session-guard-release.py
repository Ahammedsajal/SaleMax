"""Guarded app-only Sales Finance session compatibility release."""
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

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
DB = 'salemax-db-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
IMAGE_ID = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
HELPER = 'deploy/sales-finance-session-guard-release.py'
FILES = ('modules/platform/mount-existing-upgrade.js',
         'modules/platform/team-role-request-guard.js')


def run(*args, env=None, check=True, timeout=300):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError('command failed: ' + Path(args[0]).name)
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def inventory():
    names = run('docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=salemax',
                '--format', '{{.Names}}').splitlines()
    return {name: inspect(name)['Id'] for name in names}


def compose_context(app):
    labels = app.get('Config', {}).get('Labels') or {}
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != 'app':
        raise RuntimeError('unexpected production app identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if not files or not env_files or not workdir or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('active Compose inputs are incomplete')
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
            raise RuntimeError('missing Compose interpolation input')
    env = dict(os.environ)
    for key in referenced:
        env.pop(key, None)
    env.update(values)
    return env, values


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
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('unexpected host or active base release')


def write_private(path, data):
    path = Path(path)
    path.write_text(data)
    path.chmod(0o600)


def stage(source_root, stage_path, commit):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('invalid source commit')
    source_root, stage_path = Path(source_root).resolve(), Path(stage_path).resolve()
    if stage_path.exists():
        raise RuntimeError('staging path already exists')
    (stage_path / 'source').mkdir(parents=True)
    hashes = {}
    for name in FILES:
        data = (source_root / name).read_bytes()
        target = stage_path / 'source' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        hashes[name] = sha(data)
    (stage_path / 'source' / HELPER).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(__file__), stage_path / 'source' / HELPER)
    helper_hash = sha(Path(__file__).read_bytes())
    (stage_path / 'manifest.json').write_text(json.dumps({'commit': commit, 'hashes': hashes,
                                                         'releaseHelperHash': helper_hash}, indent=2) + '\n')
    print(json.dumps({'staged': str(stage_path), 'commit': commit, 'hashes': hashes}))


def deploy(stage_path, commit):
    require_lock()
    stage_path = Path(stage_path).resolve()
    manifest = json.loads((stage_path / 'manifest.json').read_text())
    if manifest.get('commit') != commit or not all((stage_path / 'source' / name).is_file() for name in FILES):
        raise RuntimeError('staged source does not match requested commit')
    if sha((stage_path / 'source' / HELPER).read_bytes()) != manifest.get('releaseHelperHash'):
        raise RuntimeError('staged release helper hash mismatch')
    if any(sha((stage_path / 'source' / name).read_bytes()) != manifest['hashes'].get(name) for name in FILES):
        raise RuntimeError('staged source hash mismatch')
    app, db = inspect(APP), inspect(DB)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != IMAGE_ID:
        raise RuntimeError('active app health or image differs from reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('database is unhealthy')
    if os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize < 2_000_000_000:
        raise RuntimeError('insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env, variables = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id'] or before_inventory.get(DB) != db['Id']:
        raise RuntimeError('production containers changed during preflight')
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    app_config = before.get('services', {}).get('app') or {}
    if app_config.get('image') != app['Config']['Image']:
        raise RuntimeError('resolved Compose image differs from running app')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'sales-finance-session-guard-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-sales-finance-session-guard-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = {}
    for name in FILES:
        result = run('docker', 'exec', APP, 'cat', '/app/' + name)
        prior = result.encode()
        preimages[name] = prior
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes((stage_path / 'source' / name).read_bytes())
        output.chmod(0o644)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(prior)
        saved.chmod(0o600)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in FILES]
    overlay = release / 'compose.sales-finance-session-guard.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    shutil.copy2(stage_path / 'source' / HELPER, release / 'deploy-helper.py')
    support = {name: identity for name, identity in before_inventory.items() if name != APP}
    records = {
        'app-before.json': json.dumps({'id': app['Id'], 'image': app['Config']['Image'], 'imageId': app['Image']}, indent=2) + '\n',
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'compose-vars.json': json.dumps(variables),
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'preimage-hashes.json': json.dumps({name: sha(data) for name, data in preimages.items()}, indent=2) + '\n',
        'support-services.json': json.dumps(support, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
    }
    for name, data in records.items():
        write_private(backup / name, data)
    candidate = common + ['-f', str(overlay)]
    run(*(candidate + ['config', '--format', 'json']), env=env)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during release preparation')
    try:
        run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=900)
        current = wait_healthy()
        if current['Image'] != app['Image']:
            raise RuntimeError('app image changed unexpectedly')
        if current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files + [str(overlay)]):
            raise RuntimeError('unexpected active Compose chain')
        after_inventory = inventory()
        if {n: i for n, i in after_inventory.items() if n != APP} != support:
            raise RuntimeError('a non-app production container changed')
        for name, expected in manifest['hashes'].items():
            observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
            if observed != expected:
                raise RuntimeError('runtime hash mismatch: ' + name)
        health = run('curl', '--connect-timeout', '15', '--max-time', '30', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/healthz').strip()
        if health != '200':
            raise RuntimeError('public health check failed')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'imageId': current['Image'], 'composeInputs': len(files) + 1,
                  'environmentInputs': len(env_files), 'appMounts': len(current['Mounts']),
                  'migrations': 'none', 'runtimeHashes': manifest['hashes'],
                  'preimageHashes': json.loads((backup / 'preimage-hashes.json').read_text()),
                  'nonAppContainersUnchanged': len(after_inventory) - 1, 'appHealthy': True,
                  'publicHealth': health}
        write_private(backup / 'result.json', json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        active = inspect(APP).get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            run(*(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=900)
            wait_healthy()
        raise


def restore(backup_path):
    require_lock()
    backup = Path(backup_path).resolve()
    if not backup.is_relative_to(ROOT / 'shared') or not backup.is_dir():
        raise RuntimeError('rollback snapshot is outside protected shared storage')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.sales-finance-session-guard.json'
    app = inspect(APP)
    if app['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files + [str(overlay)]):
        raise RuntimeError('a later app overlay is active; restore it first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if not Path(name).is_file() or sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('rollback Compose input changed')
    support = json.loads((backup / 'support-services.json').read_text())
    if {n: i for n, i in inventory().items() if n != APP} != support:
        raise RuntimeError('a non-app production container changed since this release')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    env = dict(os.environ); env.update(variables)
    workdir = (backup / 'compose-working-dir.txt').read_text().strip()
    common = compose_args(files, env_files, workdir)
    run(*(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=900)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if (current['Image'] != prior['imageId'] or current['Config']['Image'] != prior['image'] or
            current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files)):
        raise RuntimeError('prior app Compose chain did not restore')
    for name, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if observed != digest:
            raise RuntimeError('rollback file hash mismatch: ' + name)
    if {n: i for n, i in inventory().items() if n != APP} != support:
        raise RuntimeError('a non-app production container changed during rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True, 'imageId': current['Image'], 'migrations': 'none'}))


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        restore(args[1])
    else:
        raise SystemExit('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'error': f'{type(error).__name__}: {error}'}), file=sys.stderr)
        raise SystemExit(1)
