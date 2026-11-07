"""Guarded app-only overlay for the 7Network human imagery website refresh.

Deploy on carsqatar-prod-01 under the production lock. The overlay mounts only
the reviewed website HTML and CSS; it does not rebuild the image or touch data.
"""
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
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
SOURCE_FILES = (
    'client/public/website/index.html',
    'client/public/website/website.css',
    'client/public/website/media/customer-enquiry-owner.webp',
    'client/public/website/media/customer-welcome.webp',
    'client/public/website/media/team-collaboration.webp',
    'client/public/website/media/team-follow-up.webp',
    'client/public/website/media/7network-contact.webp',
)
OLD_HASHES = {
    'client/public/website/index.html': 'f64a1b9efc6b08b433d04d0f480ac9989df95b6921383a8f94f6913ff1b004cb',
    'client/public/website/website.css': 'ee86769f7119696fe7a421cec3d37625a4a0e36b7ab9a3748de0418cbd6718ed',
}
NEW_FILES = SOURCE_FILES[2:]
EXPECTED_IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
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


def require_production_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')


def deploy(stage, commit):
    require_production_lock()
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if not all((stage / name).is_file() for name in SOURCE_FILES):
        raise RuntimeError('Staging directory is missing reviewed website assets')
    os.umask(0o077)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not env_files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')

    release = ROOT / 'releases' / f'website-human-imagery-{commit[:12]}-20261107'
    backup = ROOT / 'shared' / f'rollback-website-human-imagery-{commit[:12]}-20261107'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
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
        if run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
            raise RuntimeError('Live file changed: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Preimage copy changed: ' + name)
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    (backup / 'absent-paths.txt').write_text('')
    for name in NEW_FILES:
        target = '/app/' + name
        if run('docker', 'exec', APP, 'test', '!', '-e', target).strip():
            raise RuntimeError('Expected the new website asset path to be absent: ' + name)
        (backup / 'absent-paths.txt').write_text(name + '\n')
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.website-human-imagery.json'
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
    (release / 'deploy').mkdir(mode=0o755)
    (release / 'deploy/website-human-imagery-release.py').write_bytes(Path(__file__).read_bytes())
    (release / 'deploy/website-human-imagery-release.py').chmod(0o644)

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
    require_production_lock()
    if os.path.realpath(ROOT / 'current') != (backup / 'base-release.txt').read_text().strip():
        raise RuntimeError('Production base release changed')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.website-human-imagery.json'
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
    for name, expected in OLD_HASHES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + name)
    for name in (backup / 'absent-paths.txt').read_text().splitlines():
        if run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name).strip():
            raise RuntimeError('Rollback did not restore the absent path: ' + name)
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
        raise SystemExit('Usage: website-human-imagery-release.py deploy <stage> <commit> | restore <backup>')
