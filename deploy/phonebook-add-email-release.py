"""Guarded app-only overlay for email entry in the existing legacy Phonebook dialog."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
APP_TARGETS = {
    'client/public/index.html': '/app/client/public/index.html',
    'client/public/phonebook-add-contact.js': '/app/client/public/phonebook-add-contact.js',
    'client/public/phonebook-add-contact.css': '/app/client/public/phonebook-add-contact.css',
}


def run(*args, check=True, env=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env)
    if check and result.returncode:
        raise RuntimeError('production command failed: ' + Path(args[0]).name)
    return result


def inspect(name):
    return json.loads(run('docker', 'inspect', name).stdout)[0]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify_public_asset(path, expected):
    request = urllib.request.Request('https://7network.live/' + path + '?v=20261126-add-email1',
                                     headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = response.read()
        if response.status != 200 or sha(payload) != expected:
            raise RuntimeError('public Phonebook asset does not match release')
    return response.status


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('protected production lock required')
    if run('hostname').stdout.strip() != 'carsqatar-prod-01':
        raise RuntimeError('unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('active base release changed')


def compose_state(app):
    labels = app['Config']['Labels'] or {}
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    service = labels.get('com.docker.compose.service')
    if not files or not workdir or not service or service != 'app' or any(not Path(x).is_file() for x in files):
        raise RuntimeError('active Compose inputs are incomplete')
    return files, workdir, service


def compose_args(files, workdir, override=None):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir,
            '--env-file', str(ROOT / 'shared/stack.env'), '--env-file', str(ROOT / 'shared/runtime.env')]
    for name in files:
        args += ['-f', name]
    if override:
        args += ['-f', str(override)]
    return args


def compose_env(files, app, workdir):
    env_files = [ROOT / 'shared/stack.env', ROOT / 'shared/runtime.env', Path(workdir) / '.env']
    manual_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(manual_path.read_text())
    supplied = {key for name in env_files if Path(name).is_file() for key in re.findall(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    supplied.update(os.environ)
    referenced = set()
    for name in files:
        for match in re.finditer(r'\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}', Path(name).read_text()):
            key, operator = match.groups()
            if not operator.startswith((':-', '-', ':+', '+')):
                referenced.add(key)
    live = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    mounts = {mount['Destination']: mount['Source'] for mount in app.get('Mounts', [])}
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live:
            variables[key] = live[key]
        elif key.endswith(('_BASE_IMAGE', '_APP_IMAGE')):
            variables[key] = app['Config']['Image']
        else:
            inferred = set()
            release_candidates = []
            pattern = re.compile(r'\$\{' + re.escape(key) + r'(?::[-?+][^}]*)?\}([^:\s]*)\s*:\s*(/app/[^:\s]+)')
            for name in files:
                content = Path(name).read_text()
                if '${' + key in content:
                    config_dir = Path(name).parent
                    release_root = config_dir.parent if config_dir.name == 'deploy' else config_dir
                    if release_root.parent.name == 'releases':
                        release_candidates.append(str(release_root))
                for match in pattern.finditer(content):
                    suffix, target = match.groups()
                    config_dir = Path(name).parent
                    release_root = config_dir.parent if config_dir.name == 'deploy' else config_dir
                    if release_root.parent.name == 'releases':
                        release_candidates.append(str(release_root))
                        continue
                    source = mounts.get(target)
                    if source and (not suffix or source.endswith(suffix)):
                        inferred.add(source[:-len(suffix)] if suffix else source)
            if release_candidates:
                variables[key] = release_candidates[-1]
            elif len(inferred) == 1:
                variables[key] = inferred.pop()
            else:
                raise RuntimeError('production Compose input is missing required variable: ' + key)
    return dict(os.environ, **variables)


def compose_config(args, env):
    return json.loads(run(*args, 'config', '--format', 'json', env=env).stdout)


def support_services():
    names = run('docker', 'ps', '--filter', 'label=com.docker.compose.project=salemax', '--format', '{{.Names}}').stdout.splitlines()
    return {name: inspect(name)['Id'] for name in names if name and name != APP}


def verify_support_services(expected):
    for name, identity in expected.items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('a non-app service identity changed')


def copy_from_app(path, destination):
    run('docker', 'cp', f'{APP}:{path}', str(destination))
    destination.chmod(0o600)


def patch_index(content):
    css = '<link rel="stylesheet" href="/phonebook-workspace.css?v=20261112-email-marketing1">'
    js = '<script defer src="/phonebook-workspace.js?v=20261112-email-marketing1"></script>'
    if content.count(css) != 1 or content.count(js) != 1:
        raise RuntimeError('phonebook asset references do not match reviewed production shell')
    css_add = '<link rel="stylesheet" href="/phonebook-add-contact.css?v=20261126-add-email1">'
    js_add = '<script defer src="/phonebook-add-contact.js?v=20261126-add-email1"></script>'
    if css_add in content or js_add in content:
        raise RuntimeError('email-entry assets are already referenced')
    return content.replace(css, css + '\n' + css_add, 1).replace(js, js + '\n' + js_add, 1)


def volume_specs(app, replacements=None):
    replacements = replacements or {}
    volumes = []
    for mount in app.get('Mounts', []):
        item = {'type': mount['Type'], 'source': replacements.get(mount['Destination'], mount['Source']),
                'target': mount['Destination']}
        if not mount.get('RW', True):
            item['read_only'] = True
        if mount['Type'] == 'bind' and mount.get('Propagation') not in (None, '', 'rprivate'):
            item['bind'] = {'propagation': mount['Propagation']}
        volumes.append(item)
    return volumes


def validate_overlay(before, after, expected_volumes):
    if {k: v for k, v in before['services'].items() if k != 'app'} != {k: v for k, v in after['services'].items() if k != 'app'}:
        raise RuntimeError('candidate changes another Compose service')
    old = before['services']['app']
    new = after['services']['app']
    old_app, new_app = dict(old), dict(new)
    old_volumes, new_volumes = old_app.pop('volumes', []), new_app.pop('volumes', [])
    if old_app != new_app:
        raise RuntimeError('candidate changes non-volume app configuration')
    expected = {volume['target']: volume for volume in expected_volumes}
    current = {volume['target']: volume for volume in new_volumes}
    if set(current) != set(expected):
        raise RuntimeError('candidate changes the live app mount set')
    for target, volume in expected.items():
        actual = current[target]
        if any(actual.get(k) != volume.get(k) for k in ('type', 'source', 'target')) or bool(actual.get('read_only')) != bool(volume.get('read_only')):
            raise RuntimeError('candidate does not preserve the reviewed live app mounts')


def deploy(source, source_commit):
    require_lock()
    source = Path(source).resolve()
    if not re.fullmatch(r'[0-9a-f]{40}', source_commit):
        raise RuntimeError('a full source commit SHA is required')
    for name in ('phonebook-add-contact.js', 'phonebook-add-contact.css', 'phonebook-add-email-release.py'):
        if not (source / name).is_file():
            raise RuntimeError('staged release input missing')
    app = inspect(APP)
    if app.get('Image') != EXPECTED_IMAGE or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('app image or health differs from reviewed production state')
    files, workdir, service = compose_state(app)
    env = compose_env(files, app, workdir)
    before = compose_config(compose_args(files, workdir), env)
    support = support_services()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release_name = f'phonebook-add-email-{source_commit[:12]}-{stamp}'
    release = ROOT / 'releases' / release_name
    snapshot = ROOT / 'shared' / f'rollback-{release_name}'
    release.mkdir(mode=0o750)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o750)
    deploy_dir = release / 'deploy'
    deploy_dir.mkdir(mode=0o750)
    snapshot.mkdir(mode=0o700)
    os.chmod(snapshot, 0o700)
    try:
        prior = {'release': release_name, 'source_commit': source_commit, 'active_base': BASE, 'app_id': app['Id'], 'image': app['Image'],
                 'config_files': files, 'working_dir': workdir, 'service': service,
                 'support_services': support,
                 'app_mounts': {m['Destination']: m['Source'] for m in app['Mounts']},
                 'app_mount_modes': {m['Destination']: {'type': m['Type'], 'read_only': not m.get('RW', True),
                                                        'propagation': m.get('Propagation')} for m in app['Mounts']},
                 'targets': list(APP_TARGETS.values())}
        (snapshot / 'state.json').write_text(json.dumps(prior, indent=2) + '\n')
        (snapshot / 'state.json').chmod(0o600)
        copy_from_app(APP_TARGETS['client/public/index.html'], snapshot / 'index.before.html')
        index = (snapshot / 'index.before.html').read_text()
        prior['index_sha256'] = sha(index.encode())
        (snapshot / 'state.json').write_text(json.dumps(prior, indent=2) + '\n')
        (snapshot / 'state.json').chmod(0o600)
        patched = patch_index(index).encode()
        (runtime / 'client').mkdir(parents=True, mode=0o750)
        (runtime / 'client/public').mkdir(mode=0o750)
        (runtime / 'client/public/index.html').write_bytes(patched)
        for filename in ('phonebook-add-contact.js', 'phonebook-add-contact.css'):
            target = runtime / 'client/public' / filename
            target.write_bytes((source / filename).read_bytes())
            target.chmod(0o640)
        compose_file = deploy_dir / f'compose.{release_name}.json'
        replacements = {target: str(runtime / 'client/public' / Path(key).name) for key, target in APP_TARGETS.items()}
        volumes = volume_specs(app, replacements)
        compose_file.write_text(json.dumps({'services': {'app': {'volumes': volumes}}, 'name': 'salemax'}, indent=2) + '\n')
        compose_file.chmod(0o640)
        run('cp', str(source / 'phonebook-add-email-release.py'), str(deploy_dir / 'phonebook-add-email-release.py'))
        after = compose_config(compose_args(files, workdir, compose_file), env)
        validate_overlay(before, after, volumes)
        compose = compose_args(files, workdir, compose_file)
        run(*compose, 'up', '-d', '--no-deps', '--no-build', service, env=env)
        for _ in range(45):
            app = inspect(APP)
            if app['State'].get('Health', {}).get('Status') == 'healthy':
                break
            time.sleep(2)
        else:
            raise RuntimeError('app health did not recover')
        if app.get('Image') != EXPECTED_IMAGE:
            raise RuntimeError('app image changed unexpectedly')
        verify_support_services(support)
        hashes = {target: sha((runtime / 'client/public' / Path(key).name).read_bytes()) for key, target in APP_TARGETS.items()}
        actual = run('docker', 'exec', APP, 'sha256sum', *APP_TARGETS.values()).stdout
        for line in actual.splitlines():
            expected_hash, path = line.split(None, 1)
            target = path.removeprefix('/app/')
            if hashes.get(target) != expected_hash:
                raise RuntimeError('running app asset hash does not match release')
        status = run('curl', '--silent', '--show-error', '--fail', '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/healthz').stdout.strip()
        if status != '200':
            raise RuntimeError('public health check did not return HTTP 200')
        asset_status = {}
        for key in ('client/public/phonebook-add-contact.js', 'client/public/phonebook-add-contact.css'):
            asset_status[key] = verify_public_asset(Path(key).name, hashes[key])
        meta = {'release': str(release), 'snapshot': str(snapshot), 'source_commit': source_commit, 'image': app['Image'], 'hashes': hashes,
                'app_id_after': app['Id'], 'public_health_http': status, 'public_assets_http': asset_status, 'migration': 'none',
                'database_change': 'none'}
        (snapshot / 'deployment.json').write_text(json.dumps(meta, indent=2) + '\n')
        (snapshot / 'deployment.json').chmod(0o600)
        print(json.dumps(meta, indent=2))
    except Exception:
        try:
            # Restore the pre-change Compose chain. No database state is touched.
            rollback = compose_args(files, workdir)
            run(*rollback, 'up', '-d', '--no-deps', '--no-build', service, check=False, env=env)
            for _ in range(45):
                if inspect(APP)['State'].get('Health', {}).get('Status') == 'healthy':
                    break
                time.sleep(2)
        finally:
            raise


def restore(snapshot_path):
    require_lock()
    snapshot = Path(snapshot_path)
    prior = json.loads((snapshot / 'state.json').read_text())
    if prior['active_base'] != BASE:
        raise RuntimeError('rollback snapshot base does not match active release')
    app = inspect(APP)
    labels = app['Config']['Labels'] or {}
    current_files = labels.get('com.docker.compose.project.config_files', '').split(',')
    extra = [f for f in current_files if f not in prior['config_files']]
    if len(extra) > 1 or (extra and 'phonebook-add-email' not in extra[0]):
        raise RuntimeError('phonebook overlay is not the sole newest Compose input')
    env = compose_env(prior['config_files'], app, prior['working_dir'])
    before_args = compose_args(prior['config_files'], prior['working_dir'])
    before = compose_config(before_args, env)
    mode_by_target = prior.get('app_mount_modes', {})
    restored = []
    for target, source in prior['app_mounts'].items():
        mode = mode_by_target.get(target, {})
        item = {'type': mode.get('type', 'bind'), 'source': source, 'target': target}
        if mode.get('read_only'):
            item['read_only'] = True
        if item['type'] == 'bind' and mode.get('propagation') not in (None, '', 'rprivate'):
            item['bind'] = {'propagation': mode['propagation']}
        restored.append(item)
    restore_file = snapshot / 'compose.restore-phonebook-email.json'
    restore_file.write_text(json.dumps({'services': {'app': {'volumes': restored}}, 'name': 'salemax'}, indent=2) + '\n')
    restore_file.chmod(0o600)
    after = compose_config(compose_args(prior['config_files'], prior['working_dir'], restore_file), env)
    validate_overlay(before, after, restored)
    compose = compose_args(prior['config_files'], prior['working_dir'], restore_file)
    run(*compose, 'up', '-d', '--no-deps', '--no-build', prior['service'], env=env)
    for _ in range(45):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(2)
    else:
        raise RuntimeError('app health did not recover after restore')
    verify_support_services(prior['support_services'])
    print(json.dumps({'restored': True, 'snapshot': str(snapshot), 'image': app['Image'], 'app_id_after': app['Id']}, indent=2))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(sys.argv[2])
    else:
        raise SystemExit('usage: phonebook-add-email-release.py deploy SOURCE_DIR SOURCE_COMMIT | restore SNAPSHOT_DIR')
