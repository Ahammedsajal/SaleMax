#!/usr/bin/env python3
"""Guarded app-only release for Email Marketing audience review."""
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
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
UI = 'client/public/email-marketing-workspace.js'
CSS = 'client/public/email-marketing-workspace.css'
SERVICE = 'modules/platform/email-marketing.js'
WORKER = 'modules/platform/email-marketing-worker.js'
INDEX = 'client/public/index.html'
HELPER = 'deploy/email-marketing-campaign-audience-release.py'
SOURCE_FILES = (UI, CSS, SERVICE, WORKER, INDEX, HELPER)
RUNTIME_FILES = (UI, CSS, SERVICE, WORKER, INDEX)
OLD_UI_REF = b'/email-marketing-workspace.js?v=20261118-imported-list-eligibility1'
NEW_UI_REF = b'/email-marketing-workspace.js?v=20261118-campaign-audience-review1'
OLD_CSS_REF = b'/email-marketing-workspace.css?v=20261118-unified-domain-dns1'
NEW_CSS_REF = b'/email-marketing-workspace.css?v=20261118-campaign-audience-review1'
SIDEBAR_REF = b'/training-sidebar.js?v=20261117-email-marketing-nav1'
PREIMAGES = {
    UI: 'da554196bfd326e7cf0b528f4320974801dfac1436954b931825f895b7b2d5ab',
    CSS: '7f9b59b792fdfc04fe7155fea41f921f78cb9be79c5dbaca1d9a8c25276808d4',
    SERVICE: '00d0e6f61e41e83d1b72feb0930493816b707868cbb93305949bac2f7e910b16',
    WORKER: 'fcb59067b013e09542fcb5206fdc502aa5050a6004d25690f4e88b8f3fc01468',
    INDEX: 'a32f7daca1bd8901d68f43415d1ce466a38cca72c0fe11d3e294c2377318d9ed',
}
MINIMUM_FREE_BYTES = 4 * 1024**3

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
    if (labels.get('com.docker.compose.project') != 'salemax' or
            labels.get('com.docker.compose.service') != 'app'):
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
    referenced = set()
    supplied = set()
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
            raise RuntimeError('Missing Compose interpolation input')
    env = dict(os.environ)
    for key in referenced:
        env.pop(key, None)
    env.update(values)
    return env, values


def verify_live_compose_app(app, config):
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
    expected = {row['target']: row for row in before['services']['app'].get('volumes', [])}
    actual = {row['target']: row for row in after['services']['app'].get('volumes', [])}
    for mount in mounts:
        target = mount['target']
        row = actual.pop(target, {})
        expected.pop(target, None)
        if any(row.get(key) != mount.get(key) for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate is missing a reviewed read-only bind: ' + target)
    if actual != expected:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app = copy.deepcopy(before['services']['app'])
    after_app = copy.deepcopy(after['services']['app'])
    before_app.pop('volumes', None)
    after_app.pop('volumes', None)
    if before_app != after_app:
        raise RuntimeError('Candidate changes app configuration beyond file mounts')
    before_other = {key: value for key, value in before['services'].items() if key != 'app'}
    after_other = {key: value for key, value in after['services'].items() if key != 'app'}
    if before_other != after_other:
        raise RuntimeError('Candidate changes another service')


def wait_healthy():
    for _ in range(60):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('App did not return to healthy state')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active production base release changed')


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
                raise RuntimeError('Reviewed source file is missing or is a symlink: ' + name)
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
        manifest_path = stage_path / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        manifest_path.chmod(0o600)
    except Exception:
        shutil.rmtree(stage_path, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(stage_path), 'sourceCommit': commit, 'files': files}))


def validate_stage(stage_path, commit):
    stage_path = Path(stage_path).resolve()
    manifest_path = stage_path / 'manifest.json'
    if stage_path.is_symlink() or not stage_path.is_dir() or manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError('Stage or manifest is missing or invalid')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != set(SOURCE_FILES):
        raise RuntimeError('Stage manifest differs from reviewed source')
    for name, digest in manifest['files'].items():
        path = stage_path / 'source' / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Staged source hash mismatch: ' + name)
    index = (stage_path / 'source' / INDEX).read_bytes()
    if index.count(NEW_UI_REF) != 1 or index.count(NEW_CSS_REF) != 1 or index.count(SIDEBAR_REF) != 1:
        raise RuntimeError('Committed shell does not reference the reviewed Email Marketing assets')
    ui = (stage_path / 'source' / UI).read_text()
    css = (stage_path / 'source' / CSS).read_text()
    service = (stage_path / 'source' / SERVICE).read_text()
    worker = (stage_path / 'source' / WORKER).read_text()
    if ('function renderAudienceReview' not in ui or 'data-audience-page' not in ui or
            'No recorded opt-in · included' not in ui or 'You are responsible for the selected recipient list.' not in ui or 'em-audience-review' not in css or
            'em-audience-list' not in css or 'function previewAudience' not in service or
            'pageSize,pageCount' not in service or 'withoutRecordedOptInCount:audience.noConsent' not in service or
            'if(Number(row.email_marketing_consent)!==1)result.noConsent++;' not in service or
            'result.noConsent++;continue;' in service or 'CONTACT_UNSUBSCRIBED' not in worker or
            'CONTACT_CONSENT_REVOKED' in worker or 'inbound.replyToken' not in worker):
        raise RuntimeError('Staged Email Marketing audience or unsubscribe behavior is missing')
    return stage_path, manifest


def patch_live_index(data):
    if sha(data) != PREIMAGES[INDEX]:
        raise RuntimeError('Live workspace shell differs from the reviewed production preimage')
    if (data.count(OLD_UI_REF) != 1 or data.count(OLD_CSS_REF) != 1 or
            data.count(SIDEBAR_REF) != 1):
        raise RuntimeError('Live shell asset cache or Email Marketing sidebar reference changed')
    result = data.replace(OLD_UI_REF, NEW_UI_REF, 1).replace(OLD_CSS_REF, NEW_CSS_REF, 1)
    if (result.count(NEW_UI_REF) != 1 or result.count(NEW_CSS_REF) != 1 or
            OLD_UI_REF in result or OLD_CSS_REF in result):
        raise RuntimeError('Live shell Email Marketing cache references could not be updated safely')
    return result


def public_check(expected_hashes):
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public health endpoint did not return HTTP 200')
    with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public Email Marketing workspace did not return HTTP 200')
        shell = response.read()
    if NEW_UI_REF not in shell or NEW_CSS_REF not in shell or SIDEBAR_REF not in shell:
        raise RuntimeError('Public shell does not reference the updated Email Marketing assets and sidebar')
    try:
        with urlopen('https://7network.live/api/workspace/email-marketing/setup', timeout=20) as response:
            status = response.status
    except HTTPError as error:
        status = error.code
    if status != 401:
        raise RuntimeError('Anonymous Email Marketing setup API did not return HTTP 401')
    with urlopen('https://7network.live' + NEW_UI_REF.decode('ascii'), timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Updated Email Marketing script did not return HTTP 200')
        ui_asset = response.read()
    if sha(ui_asset) != expected_hashes[UI]:
        raise RuntimeError('Public Email Marketing script hash mismatch')
    with urlopen('https://7network.live' + NEW_CSS_REF.decode('ascii'), timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Updated Email Marketing stylesheet did not return HTTP 200')
        css_asset = response.read()
    if sha(css_asset) != expected_hashes[CSS]:
        raise RuntimeError('Public Email Marketing stylesheet hash mismatch')
    return {'healthz': 'HTTP 200', 'workspaceShell': 'HTTP 200',
            'anonymousSetupApi': 'HTTP 401', 'workspaceScript': 'HTTP 200',
            'workspaceStylesheet': 'HTTP 200'}


def deploy(stage_path, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage_path, manifest = validate_stage(stage_path, commit)
    app = inspect(APP)
    db = inspect(DB)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    stat = os.statvfs(ROOT)
    if stat.f_bavail * stat.f_frsize < MINIMUM_FREE_BYTES:
        raise RuntimeError('Insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env, variables = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during deployment preflight')
    prior = {}
    for name, expected in PREIMAGES.items():
        data = run('docker', 'exec', APP, 'cat', '/app/' + name).encode()
        if sha(data) != expected:
            raise RuntimeError('Live file differs from reviewed preimage: ' + name)
        prior[name] = data
    changed = {name: (stage_path / 'source' / name).read_bytes() for name in (UI, CSS, SERVICE, WORKER)}
    changed[INDEX] = patch_live_index(prior[INDEX])
    deployed_hashes = {name: sha(data) for name, data in changed.items()}
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    verify_live_compose_app(app, before)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-campaign-audience-review-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-campaign-audience-review-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    for name, data in prior.items():
        saved = preimages / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        saved.write_bytes(data)
        saved.chmod(0o600)
    for name, data in changed.items():
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-campaign-audience-review.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'],
                                                        'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_target = release / HELPER
    helper_target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_target.write_bytes((stage_path / 'source' / HELPER).read_bytes())
    helper_target.chmod(0o644)
    backup_files = {
        'app-before.json': json.dumps({'id': app['Id'], 'image': app['Config']['Image'],
                                       'imageId': app['Image'], 'health': app['State']['Health']['Status'],
                                       'restartCount': app.get('RestartCount', 0)}, indent=2) + '\n',
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'base-release.txt': BASE + '\n',
        'compose-vars.json': json.dumps(variables),
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'preimage-hashes.json': json.dumps({name: sha(data) for name, data in prior.items()}, indent=2) + '\n',
        'support-services.json': json.dumps({name: identity for name, identity in before_inventory.items()
                                             if name != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
    }
    for name, data in backup_files.items():
        write_private(backup / name, data)

    candidate = common + ['-f', str(overlay)]
    after = json.loads(run(*(candidate + ['config', '--format', 'json']), env=env))
    validate_candidate(before, after, mounts)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during release preparation')
    if inventory() != before_inventory or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Production container inventory changed during release preparation')
    try:
        run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
            env=env, timeout=900)
        current = wait_healthy()
        expected_chain = ','.join(files + [str(overlay)])
        if current['Config']['Labels'].get('com.docker.compose.project.config_files') != expected_chain:
            raise RuntimeError('Unexpected active Compose chain')
        if current['Image'] != app['Image']:
            raise RuntimeError('App image changed unexpectedly')
        after_inventory = inventory()
        if {name: identity for name, identity in after_inventory.items() if name != APP} != {
                name: identity for name, identity in before_inventory.items() if name != APP}:
            raise RuntimeError('A non-app production container changed')
        for name, digest in deployed_hashes.items():
            observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
            if observed != digest:
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        public = public_check(deployed_hashes)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'imageReference': current['Config']['Image'],
                  'composeInputs': len(files) + 1, 'environmentInputs': len(env_files),
                  'appMounts': len(current['Mounts']), 'migrations': 'none',
                  'runtimeHashes': deployed_hashes,
                  'preimageHashes': {name: sha(data) for name, data in prior.items()},
                  'nonAppContainersUnchanged': len(after_inventory) - 1,
                  'appHealthy': True, 'publicChecks': public, 'emailSent': False, 'campaignCreated': False, 'domainDeleted': False}
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception:
        active = inspect(APP).get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            run(*(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
                env=env, timeout=900)
            wait_healthy()
        raise


def restore(backup_path):
    require_lock()
    backup = Path(backup_path).resolve()
    if not backup.is_relative_to(ROOT / 'shared') or not backup.is_dir():
        raise RuntimeError('Rollback snapshot is outside protected shared storage')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.email-marketing-campaign-audience-review.json'
    app = inspect(APP)
    active = app.get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
    if active != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later app overlay is active; restore it first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if not Path(name).is_file() or sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    support_before = json.loads((backup / 'support-services.json').read_text())
    current_inventory = inventory()
    if {name: identity for name, identity in current_inventory.items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed since this release')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    env = dict(os.environ)
    env.update(variables)
    workdir = (backup / 'compose-working-dir.txt').read_text().strip()
    common = compose_args(files, env_files, workdir)
    run(*(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
        env=env, timeout=900)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if (current['Image'] != prior['imageId'] or current['Config']['Image'] != prior['image'] or
            current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files)):
        raise RuntimeError('Prior app Compose chain did not restore')
    for name, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
            raise RuntimeError('Rollback preimage hash mismatch: ' + name)
    if {name: identity for name, identity in inventory().items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed during rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
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
