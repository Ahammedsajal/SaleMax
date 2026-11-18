#!/usr/bin/env python3
"""Guarded app-only release for imported email-list eligibility."""
import copy
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
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path('/opt/salemax')
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
APP = 'salemax-app-1'
DB = 'salemax-db-1'
IMAGE = 'salemax-app:email-marketing-21a07cc41fa9-20261112'
IMAGE_ID = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
SERVICE = 'modules/platform/email-marketing.js'
WORKER = 'modules/platform/email-marketing-worker.js'
UI = 'client/public/email-marketing-workspace.js'
INDEX = 'client/public/index.html'
HELPER = 'deploy/email-marketing-imported-list-eligibility-release.py'
RUNTIME_FILES = (SERVICE, WORKER, UI, INDEX)
SOURCE_FILES = (*RUNTIME_FILES, HELPER)
PREIMAGES = {
    SERVICE: '44d427a87cea88633fae3ba85065f852ef4c99caf658003b50e5591f4ea2d022',
    WORKER: 'ccafbb174e78cc7979054ce9eac237666fe2c715d340632d706f847e43c649f3',
    UI: '4f983d348aa481f75950b94ee99baa5ffdd9a5c07a983170884731da3c1765fc',
    INDEX: 'e7fb4a48bdb472c089fb506e0d27ecc723ba7a799ce3b9561956874667902f9d',
}
OLD_UI_REF = b'email-marketing-workspace.js?v=20261118-unified-domain-dns1'
NEW_UI_REF = b'email-marketing-workspace.js?v=20261118-imported-list-eligibility1'
MIN_FREE_BYTES = 1024 * 1024 * 1024
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'


def run(*args, env=None, input_text=None, timeout=600):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True,
                            text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed ({result.returncode})')
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_private(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def inventory():
    names = run('docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=salemax',
                '--format', '{{.Names}}').splitlines()
    return {name: inspect(name)['Id'] for name in names}


def compose_context(app):
    labels = app.get('Config', {}).get('Labels') or {}
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != 'app':
        raise RuntimeError('Unexpected production app identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if not files or not env_files or not workdir or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
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
    live = dict(item.split('=', 1) for item in app.get('Config', {}).get('Env', []) if '=' in item)
    manual = json.loads(MANUAL_VARS.read_text()) if MANUAL_VARS.is_file() else {}
    values = {}
    for key in referenced - supplied:
        if key in manual:
            values[key] = manual[key]
        elif key in live:
            values[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation input')
    env = dict(os.environ)
    for key in referenced:
        env.pop(key, None)
    env.update(values)
    return env


def compose_config(args, env):
    return json.loads(run(*(args + ['config', '--format', 'json']), env=env))


def verify_active_config(app, config):
    service = config.get('services', {}).get('app') or {}
    if service.get('image') != app.get('Config', {}).get('Image'):
        raise RuntimeError('Resolved Compose image differs from running app')
    expected = {row['target']: row for row in service.get('volumes', []) if row.get('type') == 'bind'}
    actual = {row['Destination']: row for row in app.get('Mounts', []) if row.get('Type') == 'bind'}
    if set(expected) != set(actual):
        raise RuntimeError('Resolved Compose bind mounts differ from running app')
    for target, volume in expected.items():
        live = actual[target]
        if (os.path.realpath(volume.get('source', '')) != os.path.realpath(live.get('Source', '')) or
                bool(volume.get('read_only', False)) != (not bool(live.get('RW', True)))):
            raise RuntimeError('Resolved Compose bind mount differs from running app: ' + target)


def validate_candidate(before, after, mounts):
    if set(before.get('services', {})) != set(after.get('services', {})):
        raise RuntimeError('Candidate Compose changes the service set')
    for name in before['services']:
        if name != 'app' and before['services'][name] != after['services'][name]:
            raise RuntimeError('Candidate Compose changes another service')
    old, new = copy.deepcopy(before['services']['app']), copy.deepcopy(after['services']['app'])
    expected = {row['target']: row for row in old.get('volumes', [])}
    actual = {row['target']: row for row in new.get('volumes', [])}
    for mount in mounts:
        target = mount['target']
        expected.pop(target, None)
        row = actual.pop(target, {})
        if any(row.get(key) != mount.get(key) for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate lacks the reviewed read-only bind: ' + target)
    if actual != expected:
        raise RuntimeError('Candidate Compose changes unexpected app mounts')
    old.pop('volumes', None)
    new.pop('volumes', None)
    if old != new:
        raise RuntimeError('Candidate changes app configuration beyond reviewed mounts')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or active base release changed')


def read_app_file(name):
    return run('docker', 'exec', APP, 'cat', '/app/' + name).encode()


def stage(source_root, stage_path, commit):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    source_root = Path(source_root).resolve()
    stage_path = Path(stage_path).expanduser().absolute()
    if stage_path.exists() or stage_path.is_symlink() or stage_path == source_root or source_root in stage_path.parents:
        raise RuntimeError('Stage path exists or is inside the source checkout')
    if run('git', '-C', str(source_root), 'rev-parse', 'HEAD').strip() != commit:
        raise RuntimeError('Checkout does not match requested source commit')
    stage_path.mkdir(mode=0o700, parents=True)
    files = {}
    try:
        for name in SOURCE_FILES:
            source = source_root / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('Reviewed source file is missing or a symlink: ' + name)
            committed = run('git', '-C', str(source_root), 'show', f'{commit}:{name}').encode()
            data = source.read_bytes()
            if data != committed:
                raise RuntimeError('File differs from committed source: ' + name)
            target = stage_path / 'source' / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
            files[name] = sha(data)
        manifest = {'sourceCommit': commit, 'files': files}
        write_private(stage_path / 'manifest.json', manifest)
    except Exception:
        shutil.rmtree(stage_path, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(stage_path), 'sourceCommit': commit, 'files': files}))


def validate_stage(stage_path, commit):
    stage_path = Path(stage_path).resolve()
    if not stage_path.is_relative_to(ROOT / 'shared') or stage_path.is_symlink() or not stage_path.is_dir():
        raise RuntimeError('Stage is outside protected shared storage')
    manifest = json.loads((stage_path / 'manifest.json').read_text())
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != set(SOURCE_FILES):
        raise RuntimeError('Stage manifest differs from reviewed source')
    contents = {}
    for name, digest in manifest['files'].items():
        path = stage_path / 'source' / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('Staged source is missing or invalid: ' + name)
        data = path.read_bytes()
        if sha(data) != digest:
            raise RuntimeError('Staged source hash mismatch: ' + name)
        contents[name] = data
    service = contents[SERVICE].decode()
    worker = contents[WORKER].decode()
    ui = contents[UI].decode()
    index = contents[INDEX]
    if ('if(Number(row.email_marketing_consent)!==1)result.noConsent++;' not in service or
            'noConsent++;continue' in service or 'CONTACT_CONSENT_REVOKED' in worker or
            'email_unsubscribed_at' not in worker or 'suppressedEmail' not in worker or
            'inbound.replyToken' not in worker or
            'Consent not recorded' not in ui or 'The sending business is responsible' not in ui or
            'explicit marketing consent are excluded' in ui or
            index.count(NEW_UI_REF) != 1 or OLD_UI_REF in index):
        raise RuntimeError('Staged Email Marketing source failed eligibility or live-feature guards')
    return stage_path, manifest, contents


def wait_healthy():
    for _ in range(60):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('App did not return to healthy state')


def public_check(expected_hash):
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public health endpoint did not return HTTP 200')
    with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Email workspace did not return HTTP 200')
        shell = response.read()
    if shell.count(NEW_UI_REF) != 1:
        raise RuntimeError('Public shell does not reference the new Email Marketing asset')
    asset_url = 'https://7network.live/' + NEW_UI_REF.decode('ascii')
    with urlopen(asset_url, timeout=20) as response:
        if response.status != 200 or sha(response.read()) != expected_hash:
            raise RuntimeError('Public Email Marketing asset hash mismatch')
    try:
        with urlopen('https://7network.live/api/workspace/email-marketing/setup', timeout=20) as response:
            status = response.status
    except HTTPError as error:
        status = error.code
    if status not in (401, 403):
        raise RuntimeError('Anonymous Email Marketing setup API was not denied')
    return {'healthz': 200, 'workspace': 200, 'asset': 200, 'anonymousSetup': status}


def deploy(stage_path, commit):
    require_lock()
    stage_path, manifest, contents = validate_stage(stage_path, commit)
    app, db = inspect(APP), inspect(DB)
    if (app['State'].get('Status') != 'running' or app['State'].get('Health', {}).get('Status') != 'healthy' or
            app['Config'].get('Image') != IMAGE or app.get('Image') != IMAGE_ID):
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if db['State'].get('Status') != 'running' or db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    stat = os.statvfs(ROOT)
    if stat.f_bavail * stat.f_frsize < MIN_FREE_BYTES:
        raise RuntimeError('Insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during deployment preflight')
    preimages = {name: read_app_file(name) for name in RUNTIME_FILES}
    if any(sha(preimages[name]) != PREIMAGES[name] for name in RUNTIME_FILES):
        raise RuntimeError('Live Email Marketing file differs from reviewed preimage')
    base_args = compose_args(files, env_files, workdir)
    before = compose_config(base_args, env)
    verify_active_config(app, before)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-imported-list-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-imported-list-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    private_preimages = backup / 'preimages'
    private_preimages.mkdir(mode=0o700)
    for name, data in preimages.items():
        saved = private_preimages / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        saved.write_bytes(data)
        saved.chmod(0o600)
    deployed = {name: contents[name] for name in RUNTIME_FILES}
    for name, data in deployed.items():
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in RUNTIME_FILES]
    overlay = release / 'compose.email-marketing-imported-list.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': IMAGE, 'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_target = release / HELPER
    helper_target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_target.write_bytes(contents[HELPER])
    helper_target.chmod(0o644)
    private_data = {
        'app-before.json': json.dumps({'id': app['Id'], 'image': app['Config']['Image'], 'imageId': app['Image'],
                                       'health': app['State']['Health']['Status'], 'restartCount': app.get('RestartCount', 0)}, indent=2) + '\n',
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'preimage-hashes.json': json.dumps({name: sha(data) for name, data in preimages.items()}, indent=2) + '\n',
        'support-services.json': json.dumps({name: identity for name, identity in before_inventory.items() if name != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
        'overlay-path.txt': str(overlay) + '\n',
    }
    for name, value in private_data.items():
        write_private(backup / name, value)
    candidate_args = base_args + ['-f', str(overlay)]
    after = compose_config(candidate_args, env)
    validate_candidate(before, after, mounts)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during release preparation')
    if inventory() != before_inventory or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Production container inventory changed during release preparation')
    try:
        run(*(candidate_args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=900)
        current = wait_healthy()
        if current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files + [str(overlay)]):
            raise RuntimeError('Unexpected active Compose chain')
        if current['Image'] != app['Image']:
            raise RuntimeError('App image changed unexpectedly')
        after_inventory = inventory()
        if {name: identity for name, identity in after_inventory.items() if name != APP} != {name: identity for name, identity in before_inventory.items() if name != APP}:
            raise RuntimeError('A non-app production container changed')
        for name, data in deployed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        for name in (SERVICE, WORKER):
            run('docker', 'exec', APP, 'node', '--check', '/app/' + name, timeout=60)
        if run('docker', 'exec', APP, 'node', '-e', "require('/app/modules/platform/email-marketing');require('/app/modules/platform/email-marketing-worker');"):
            raise RuntimeError('Email runtime import unexpectedly produced output')
        public = public_check(sha(deployed[UI]))
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'image': current['Config']['Image'],
                  'imageId': current['Image'], 'composeInputs': len(files) + 1, 'migrations': 'none',
                  'runtimeHashes': {name: sha(data) for name, data in deployed.items()}, 'publicChecks': public,
                  'nonAppContainersUnchanged': len(after_inventory) - 1, 'appHealthy': True,
                  'emailSent': False, 'contactDataChanged': False}
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception:
        active = inspect(APP).get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            run(*(base_args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=900)
            wait_healthy()
        raise


def restore(backup_path):
    require_lock()
    backup = Path(backup_path).resolve()
    if not backup.is_relative_to(ROOT / 'shared') or not backup.is_dir():
        raise RuntimeError('Rollback snapshot is outside protected shared storage')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    overlay = Path((backup / 'overlay-path.txt').read_text().strip())
    app = inspect(APP)
    active = app.get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
    if active != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later app overlay is active; restore it first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if not Path(name).is_file() or sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    support_before = json.loads((backup / 'support-services.json').read_text())
    if {name: identity for name, identity in inventory().items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed since this release')
    workdir = (backup / 'compose-working-dir.txt').read_text().strip()
    args = compose_args(files, env_files, workdir)
    env = compose_environment(app, files, env_files)
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=900)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['imageId'] or current['Config']['Image'] != prior['image'] or current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files):
        raise RuntimeError('Prior app Compose chain did not restore')
    for name, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
            raise RuntimeError('Rollback preimage hash mismatch: ' + name)
    if {name: identity for name, identity in inventory().items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed during rollback')
    print(json.dumps({'rolledBack': str(overlay.parent), 'appHealthy': True,
                      'image': current['Config']['Image'], 'migrations': 'none'}))


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
