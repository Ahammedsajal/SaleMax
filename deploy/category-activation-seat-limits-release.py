"""Guarded app-only overlay for Manage Users category activation and seat limits."""
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
LATEST_OVERLAY = '/opt/salemax/releases/website-whatsapp-contact-popup-144573769d53-20261107/compose.website-whatsapp-contact-popup.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
EXPECTED_IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
EXPECTED_COMPOSE_FILES = 143
EXPECTED_ENV_FILES = 11
EXPECTED_MOUNTS = 138
SOURCE_FILES = (
    'client/public/admin-user-plans.js',
    'modules/platform/business-provisioning.js',
    'modules/platform/business-contract-assignment.js',
    'modules/platform/catalogue-bridge.js',
    'modules/platform/existing-business-router.js',
)
INDEX_FILE = 'client/public/index.html'
CACHE_OLD = 'admin-user-plans.js?v=20261023-qr-role-limits1'
CACHE_NEW = 'admin-user-plans.js?v=20261107-category-seat-limits1'
OLD_HASHES = {
    'client/public/admin-user-plans.js': 'c0878ba794864d16d012a50a63fa37fddab5336ab1cd3f1174a54895aadbee80',
    'modules/platform/business-provisioning.js': '490e99b55f5d18971bd92e685b8af2ce7d9afea657fc7cddb4e0941949530ac7',
    'modules/platform/business-contract-assignment.js': 'a0a661bedadba8c48857ce6a68a317cf234509be067096276837c1678ce76545',
    'modules/platform/catalogue-bridge.js': 'bd0e0a38f84c2ec4bfa0d8370c3a111f5a6aab97deef47e17d2199a13ebc4d1a',
    'modules/platform/existing-business-router.js': '4186449090ff0892131701facae489cb2ab0bcc409d9e2fe5c2e1479a4dea600',
    'client/public/index.html': 'b0bdff529fee34e9d0cf366847b0fe31cca7c40b9c3b4c33e13e958fe7921715',
}
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')


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


def main(stage, commit):
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    manifest = json.loads((stage / 'source-manifest.json').read_text())
    if manifest.get('sourceCommit') != commit:
        raise RuntimeError('Staged source commit differs from release commit')
    source = {}
    for name in SOURCE_FILES:
        data = (stage / name).read_bytes()
        if manifest.get('files', {}).get(name) != sha(data):
            raise RuntimeError('Staged source hash mismatch: ' + name)
        source[name] = data

    os.umask(0o077)
    app = inspect(APP)
    labels = app['Config']['Labels']
    if app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('App is not healthy')
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if (len(files) != EXPECTED_COMPOSE_FILES or len(env_files) != EXPECTED_ENV_FILES
            or files[-1] != LATEST_OVERLAY or not all(Path(p).is_file() for p in files + env_files)):
        raise RuntimeError('Active Compose chain differs from the reviewed production baseline')
    if app['Image'] != EXPECTED_IMAGE or len(app['Mounts']) != EXPECTED_MOUNTS:
        raise RuntimeError('Active app image or mount count differs from the reviewed baseline')

    release = ROOT / 'releases' / f'category-activation-seat-limits-{commit[:12]}-20261107'
    backup = ROOT / 'shared' / f'rollback-category-activation-seat-limits-{commit[:12]}-20261107'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
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
    all_files = (*SOURCE_FILES, INDEX_FILE)
    for name in all_files:
        target = '/app/' + name
        actual = run('docker', 'exec', APP, 'sha256sum', target).split()[0]
        if actual != OLD_HASHES[name]:
            raise RuntimeError('Live file changed: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != actual:
            raise RuntimeError('Preimage copy changed: ' + name)
        if name == INDEX_FILE:
            text = saved.read_text()
            if text.count(CACHE_OLD) != 1 or CACHE_NEW in text:
                raise RuntimeError('Manage Users cache reference differs from the reviewed shell')
            data = text.replace(CACHE_OLD, CACHE_NEW, 1).encode()
        else:
            data = source[name]
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in all_files]
    overlay = release / 'compose.category-activation-seat-limits.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    release_helper = release / 'deploy' / Path(__file__).name
    release_helper.parent.mkdir(mode=0o755)
    release_helper.write_bytes(Path(__file__).read_bytes())
    release_helper.chmod(0o755)

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
        raise RuntimeError('Unexpected app mount targets')
    for target, row in new_volumes.items():
        expected = expected_volumes[target]
        if (row['type'], row.get('source'), row.get('read_only')) != (expected['type'], expected.get('source'), expected.get('read_only')):
            raise RuntimeError('Unexpected app mount: ' + target)
    old_app.pop('volumes')
    new_app.pop('volumes')
    if before != after:
        raise RuntimeError('Candidate changes non-mount Compose configuration')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    command = ('up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app')
    try:
        run(*candidate, *command, env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        if len(current['Mounts']) != EXPECTED_MOUNTS + 5:
            raise RuntimeError('Unexpected app mount count after release')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        shell = run('docker', 'exec', APP, 'grep', '-o', CACHE_NEW, '/app/' + INDEX_FILE).strip()
        if shell != CACHE_NEW:
            raise RuntimeError('New Manage Users cache reference missing')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'hashes': {name: sha(data) for name, data in changed.items()}}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, *command, env=env)
        wait_healthy()
        raise


def restore(backup):
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != (backup / 'base-release.txt').read_text().strip():
        raise RuntimeError('Production identity changed')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.category-activation-seat-limits.json'
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
    if current['Image'] != prior['Image'] or len(current['Mounts']) != EXPECTED_MOUNTS:
        raise RuntimeError('Rollback app identity mismatch')
    for name, expected in OLD_HASHES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + name)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        main(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: category-activation-seat-limits-release.py deploy <stage> <commit> | restore <backup>')
