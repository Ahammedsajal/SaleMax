"""Guarded app-only overlay for the 7Network business-workspace install control."""
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
MANIFEST = '/app/client/public/branding/7network/manifest.webmanifest'
CSS_TAG = '<link rel="stylesheet" href="/pwa-install.css?v=20261123-dashboard-install1">'
JS_TAG = '<script defer src="/pwa-install.js?v=20261123-dashboard-install1"></script>'
ASSETS = {
    'client/public/index.html': '/app/client/public/index.html',
    'client/public/pwa-install.css': '/app/client/public/pwa-install.css',
    'client/public/pwa-install.js': '/app/client/public/pwa-install.js',
}


def run(*args, check=True, env=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env)
    if check and result.returncode:
        raise RuntimeError('command failed: ' + Path(args[0]).name)
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


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('protected production lock required')
    if run('hostname').stdout.strip() != 'carsqatar-prod-01':
        raise RuntimeError('unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('active base release changed')


def wait_healthy():
    for _ in range(45):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('app health did not recover')


def copy_from_app(path, destination):
    run('docker', 'cp', f'{APP}:{path}', str(destination))
    destination.chmod(0o600)


def compose_input_state(files, env_files):
    return {name: sha(Path(name).read_bytes()) for name in files + env_files}


def load_compose_vars(files, env_files, app):
    manual_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(manual_path.read_text())
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
            raise RuntimeError('missing Compose interpolation variable')
    return dict(os.environ, **variables), variables


def support_services():
    names = run('docker', 'ps', '--filter', 'label=com.docker.compose.project=salemax',
                '--format', '{{.Names}}').stdout.splitlines()
    return {name: inspect(name)['Id'] for name in names if name and name != APP}


def verify_support_services(expected):
    for name, identity in expected.items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('non-app service identity changed')


def compose_config(args, env):
    return json.loads(run(*args, 'config', '--format', 'json', env=env).stdout)


def validate_overlay(before, after, mounts):
    old_volumes = {volume['target']: volume for volume in before['services']['app'].get('volumes', [])}
    new_volumes = {volume['target']: volume for volume in after['services']['app'].get('volumes', [])}
    for mount in mounts:
        actual = new_volumes.pop(mount['target'], {})
        old_volumes.pop(mount['target'], None)
        if any(actual.get(key) != mount[key] for key in ('type', 'source', 'target', 'read_only')):
            raise RuntimeError('candidate is missing a reviewed read-only bind')
    if new_volumes != old_volumes:
        raise RuntimeError('candidate changes unexpected app mounts')
    before_app = copy.deepcopy(before['services']['app'])
    after_app = copy.deepcopy(after['services']['app'])
    before_app.pop('volumes', None)
    after_app.pop('volumes', None)
    if before_app != after_app:
        raise RuntimeError('candidate changes non-mount app configuration')
    before_other = {key: value for key, value in before['services'].items() if key != 'app'}
    after_other = {key: value for key, value in after['services'].items() if key != 'app'}
    if before_other != after_other:
        raise RuntimeError('candidate changes another Compose service')


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('invalid source commit')
    if not stage.is_dir() or not all((stage / name).is_file() for name in ASSETS):
        raise RuntimeError('staging directory is missing reviewed runtime assets')

    staged_index = (stage / 'client/public/index.html').read_text()
    for tag in (CSS_TAG, JS_TAG):
        if staged_index.count(tag) != 1:
            raise RuntimeError('source shell does not contain the expected install asset reference')
    css = (stage / 'client/public/pwa-install.css').read_bytes()
    js = (stage / 'client/public/pwa-install.js').read_bytes()
    if not css or not js:
        raise RuntimeError('install assets are empty')

    app = inspect(APP)
    if (app['State'].get('Health', {}).get('Status') != 'healthy'
            or app['Image'] != EXPECTED_IMAGE):
        raise RuntimeError('active app health or image differs from reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    inputs = files + env_files
    if (not files or not env_files or not all(Path(path).is_file() for path in inputs)
            or not all(os.path.commonpath([str(ROOT), path]) == str(ROOT) for path in inputs)
            or os.path.commonpath([str(ROOT), workdir]) != str(ROOT)):
        raise RuntimeError('active Compose inputs are incomplete or outside the SaleMaX release root')

    compose_before = compose_args(files, env_files, workdir)
    compose_env, compose_variables = load_compose_vars(files, env_files, app)
    before = compose_config(compose_before, compose_env)
    if 'app' not in before.get('services', {}):
        raise RuntimeError('active Compose project has no app service')
    services = support_services()
    input_hashes = compose_input_state(files, env_files)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'pwa-install-dashboard-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-pwa-install-dashboard-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    write_json(backup / 'compose-vars.json', compose_variables)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    overlay = release / 'compose.pwa-install-dashboard.json'
    (backup / 'overlay-path.txt').write_text(str(overlay) + '\n')
    (backup / 'source-commit.txt').write_text(commit + '\n')
    write_json(backup / 'compose-input-hashes.json', input_hashes)
    write_json(backup / 'support-services.json', services)
    write_json(backup / 'app-before.json', {
        'id': app['Id'], 'name': app['Name'], 'image': app['Image'],
        'imageName': app['Config']['Image'], 'created': app['Created'],
        'restartCount': app['RestartCount'], 'health': app['State'].get('Health', {}).get('Status'),
        'composeFiles': files, 'envFiles': env_files, 'workingDir': workdir,
    })

    index_preimage = preimages / 'client/public/index.html'
    manifest_preimage = preimages / 'client/public/branding/7network/manifest.webmanifest'
    index_preimage.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest_preimage.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    copy_from_app(ASSETS['client/public/index.html'], index_preimage)
    copy_from_app(MANIFEST, manifest_preimage)
    manifest = json.loads(manifest_preimage.read_text())
    if (manifest.get('id') != '/user' or manifest.get('start_url') != '/user?page=dashboard'
            or manifest.get('display') != 'standalone'):
        raise RuntimeError('live manifest does not launch the standalone business dashboard')
    live_index = index_preimage.read_text()
    if (live_index.count('</head>') != 1 or 'pwa-install.' in live_index
            or not re.search(r'<link\b[^>]*rel="manifest"[^>]*>', live_index)):
        raise RuntimeError('live generated workspace shell is not in the expected state')
    for name in ('client/public/pwa-install.css', 'client/public/pwa-install.js'):
        if run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name, check=False).returncode:
            raise RuntimeError('install asset already exists in the active runtime')
    patched_index = live_index.replace('</head>', CSS_TAG + JS_TAG + '</head>', 1).encode()
    changed = {
        'client/public/index.html': patched_index,
        'client/public/pwa-install.css': css,
        'client/public/pwa-install.js': js,
    }
    preimage_hashes = {
        'client/public/index.html': sha(index_preimage.read_bytes()),
        'client/public/branding/7network/manifest.webmanifest': sha(manifest_preimage.read_bytes()),
    }
    write_json(backup / 'preimage-hashes.json', preimage_hashes)
    expected_hashes = {name: sha(data) for name, data in changed.items()}
    write_json(release / 'runtime-hashes.json', expected_hashes)

    mounts = []
    for name, data in changed.items():
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        mounts.append({'type': 'bind', 'source': str(output), 'target': ASSETS[name],
                       'read_only': True, 'bind': {'create_host_path': False}})
    overlay.write_text(json.dumps({'services': {'app': {
        'image': app['Config']['Image'], 'volumes': mounts,
    }}}))
    overlay.chmod(0o644)
    deploy_dir = release / 'deploy'
    deploy_dir.mkdir(mode=0o755)
    helper = deploy_dir / Path(__file__).name
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)

    candidate = compose_before + ['-f', str(overlay)]
    after = compose_config(candidate, compose_env)
    validate_overlay(before, after, mounts)
    if (compose_input_state(files, env_files) != input_hashes or inspect(APP)['Id'] != app['Id']):
        raise RuntimeError('running app or Compose inputs changed during release preparation')

    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=compose_env)
        current = wait_healthy()
        current_files = current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
        if current['Image'] != app['Image'] or current_files != files + [str(overlay)]:
            raise RuntimeError('app image or Compose chain changed')
        verify_support_services(services)
        for name, data in changed.items():
            actual = run('docker', 'exec', APP, 'sha256sum', ASSETS[name]).stdout.split()[0]
            if actual != sha(data):
                raise RuntimeError('runtime file hash mismatch: ' + name)
        health = run('python3', '-c',
            "import urllib.request; r=urllib.request.urlopen('https://crm.salemax.qa/healthz',timeout=20); print(r.status)").stdout.strip()
        if health != '200':
            raise RuntimeError('public health check did not return HTTP 200')
        result = {
            'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
            'image': current['Image'], 'composeInputs': len(files) + 1,
            'envInputs': len(env_files), 'appMounts': len(current['Mounts']),
            'supportServicesUnchanged': len(services), 'healthz': 'HTTP 200',
            'manifestStartUrl': manifest['start_url'], 'hashes': expected_hashes,
        }
        write_json(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception as failure:
        active = inspect(APP)
        active_files = active['Config']['Labels'].get('com.docker.compose.project.config_files', '').split(',')
        if str(overlay) in active_files:
            run(*compose_before, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app',
                check=False, env=compose_env)
            restored = wait_healthy()
            if restored['Image'] != app['Image']:
                raise RuntimeError('automatic app rollback image mismatch') from failure
            for name, digest in preimage_hashes.items():
                live_path = MANIFEST if name.endswith('manifest.webmanifest') else ASSETS[name]
                actual = run('docker', 'exec', APP, 'sha256sum', live_path).stdout.split()[0]
                if actual != digest:
                    raise RuntimeError('automatic app rollback preimage mismatch') from failure
            verify_support_services(services)
        raise failure


def restore(backup):
    require_lock()
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = Path((backup / 'overlay-path.txt').read_text().strip())
    if inspect(APP)['Config']['Labels'].get('com.docker.compose.project.config_files', '').split(',') != files + [str(overlay)]:
        raise RuntimeError('a later app release is active; restore it first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('rollback Compose input changed')
    for name, digest in json.loads((release / 'runtime-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', ASSETS[name]).stdout.split()[0] != digest:
            raise RuntimeError('active runtime file changed; refusing rollback')
    support = json.loads((backup / 'support-services.json').read_text())
    verify_support_services(support)
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    compose_env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=compose_env)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['image']:
        raise RuntimeError('rollback app image mismatch')
    for name, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        live_path = MANIFEST if name.endswith('manifest.webmanifest') else ASSETS[name]
        actual = run('docker', 'exec', APP, 'sha256sum', live_path).stdout.split()[0]
        if actual != digest:
            raise RuntimeError('rollback preimage hash mismatch')
    for name in ('client/public/pwa-install.css', 'client/public/pwa-install.js'):
        if run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name, check=False).returncode:
            raise RuntimeError('install asset remains after rollback')
    verify_support_services(support)
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'supportServicesUnchanged': True, 'databaseRollback': False}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: pwa-user-dashboard-install-release.py deploy <stage> <commit> | restore <backup>')
