#!/usr/bin/env python3
"""Deploy a reversible app-only inbound lead-link and permission overlay."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-inbound-lead-link-051cd5bf2969-20261112/compose.call-center-inbound-lead-link.json'
ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-inbound-lead-link-051cd5bf2969-20261112/deploy/call-center-inbound-lead-link-release.py')
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
PROJECT = 'salemax'
RELEASE_DAY = '20261112'
RELEASE_PREFIX = 'call-center-qatar-local-dial'
RUNTIME_FILES = (
    'modules/platform/asterisk-call-control.js',
    'modules/platform/telephony-call-leads.js',
    'modules/platform/telephony-numbering.js',
    'modules/platform/asterisk-config.js',
    'client/public/call-center/index.html',
    'client/public/call-center/call-center.js',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-call-control.js': '51a16e4b4b101a2aa57d1fd60726b0d0cafaf808d8928844f68555da40ca9043',
    'modules/platform/telephony-call-leads.js': '20696bcc7b25cf36e25c2fea79cd6a83fa9f1379c190f2731f5dcaf5e8f88d27',
    'modules/platform/asterisk-config.js': '8e5ce4aad745b5dc6307fcc536de5adcd4d9e1cb06750838d4a36c2c6f2ed272',
    'client/public/call-center/index.html': '69f98644796fd3389280cd334a38417bfd0f330c645c58623e84e17c6c6fb21b',
    'client/public/call-center/call-center.js': 'ffb7bb00ac4f03f7c425f88cd762eaaba5039e994e337bc0fbba52418e6ab502',
}
HELPER_NAME = 'deploy/call-center-inbound-lead-link-release.py'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def inventory():
    names = run('docker', 'ps', '-a', '--filter', f'label=com.docker.compose.project={PROJECT}', '--format', '{{.Names}}').splitlines()
    return {name: inspect(name)['Id'] for name in names}


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', PROJECT, '--project-directory', workdir]
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
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def prepare_stage(source_root, stage, commit):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    source_root = Path(source_root).resolve()
    stage = Path(stage).resolve()
    if stage.exists() or stage == source_root or source_root in stage.parents:
        raise RuntimeError('Stage directory exists or is inside the source checkout')
    if run('git', '-C', str(source_root), 'rev-parse', 'HEAD').strip() != commit:
        raise RuntimeError('Source checkout does not match requested commit')
    stage.mkdir(mode=0o700, parents=True)
    hashes = {}
    try:
        for name in RUNTIME_FILES:
            source = source_root / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('Source runtime file is missing or is a symlink')
            committed = subprocess.run(['git', '-C', str(source_root), 'show', f'{commit}:{name}'],
                capture_output=True, check=True).stdout
            data = source.read_bytes()
            if data != committed:
                raise RuntimeError('Runtime file differs from the committed source: ' + name)
            target = stage / 'runtime' / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
            hashes[name] = sha(data)
        helper_source = source_root / HELPER_NAME
        helper_committed = subprocess.run(['git', '-C', str(source_root), 'show', f'{commit}:{HELPER_NAME}'],
            capture_output=True, check=True).stdout
        helper_data = helper_source.read_bytes()
        if helper_data != helper_committed:
            raise RuntimeError('Deployment helper differs from the committed source')
        helper_target = stage / HELPER_NAME
        helper_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        helper_target.write_bytes(helper_data)
        helper_target.chmod(0o755)
        hashes[HELPER_NAME] = sha(helper_data)
        manifest = {'sourceCommit': commit, 'files': hashes}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (stage / 'manifest.json').chmod(0o600)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(stage), 'sourceCommit': commit, 'runtimeFiles': len(RUNTIME_FILES)}))


def validate_stage(stage, commit):
    stage = Path(stage)
    if stage.is_symlink() or not stage.is_dir():
        raise RuntimeError('Stage directory is missing or is a symlink')
    stage = stage.resolve()
    manifest = json.loads((stage / 'manifest.json').read_text())
    expected_names = set(RUNTIME_FILES) | {HELPER_NAME}
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != expected_names:
        raise RuntimeError('Stage manifest differs from the reviewed source')
    for name, digest in manifest['files'].items():
        path = stage / 'deploy' / Path(name).name if name == HELPER_NAME else stage / 'runtime' / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Staged source hash mismatch: ' + name)
    return manifest


def compose_context(app):
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or files[-1] != ACTIVE_OVERLAY:
        raise RuntimeError('Active app overlay chain differs from the reviewed Call Center release')
    if not env_files or not all(Path(name).is_file() for name in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return files, env_files, workdir


def compose_environment(app, files, env_files, backup):
    spec = importlib.util.spec_from_file_location('mobile_call_center_base_release_helper', ACTIVE_HELPER)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the previously deployed Compose resolver')
    base_helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base_helper)
    base_helper.ROOT = ROOT
    return base_helper.compose_environment(app, files, env_files, backup)


def verify_live_compose_app(app, config):
    service = config['services']['app']
    if service.get('image') != app['Config']['Image']:
        raise RuntimeError('Resolved Compose app image differs from the running app')
    expected = {row['target']: row for row in service.get('volumes', []) if row.get('type') == 'bind'}
    actual = {row['Destination']: row for row in app.get('Mounts', []) if row.get('Type') == 'bind'}
    if set(expected) != set(actual):
        raise RuntimeError('Resolved Compose bind mounts differ from the running app')
    for target, volume in expected.items():
        live = actual[target]
        source_changed = os.path.realpath(volume.get('source', '')) != os.path.realpath(live.get('Source', ''))
        read_only_changed = bool(volume.get('read_only', False)) != (not bool(live.get('RW', True)))
        if source_changed or read_only_changed:
            raise RuntimeError('Resolved Compose bind mount differs from the running app: ' + target)


def materialize_runtime_files(stage, runtime):
    content = {}
    for name in RUNTIME_FILES:
        data = (Path(stage) / 'runtime' / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o644)
        content[name] = data
    return content


def same_except_app_mounts(before, after):
    before_without_mounts, after_without_mounts = copy.deepcopy(before), copy.deepcopy(after)
    before_without_mounts['services']['app'].pop('volumes', None)
    after_without_mounts['services']['app'].pop('volumes', None)
    if before_without_mounts != after_without_mounts:
        raise RuntimeError('Candidate changes non-mount Compose configuration')


def validate_mount_overlay(before, after, mounts):
    old_volumes = {row['target']: row for row in before['services']['app'].get('volumes', [])}
    new_volumes = {row['target']: row for row in after['services']['app'].get('volumes', [])}
    expected = dict(old_volumes)
    expected.update({row['target']: row for row in mounts})
    if set(new_volumes) != set(expected):
        raise RuntimeError('Candidate changes the app mount target set')
    for target, row in expected.items():
        actual = new_volumes[target]
        if (actual.get('type'), actual.get('source'), actual.get('read_only')) != (
                row.get('type'), row.get('source'), row.get('read_only')):
            raise RuntimeError('Candidate app mount differs from the reviewed overlay: ' + target)
    same_except_app_mounts(before, after)


def deploy(stage, commit):
    require_production_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    manifest = validate_stage(stage, commit)
    os.umask(0o077)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during deployment preparation')
    for name, expected in EXPECTED_PREIMAGES.items():
        live_hash = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if live_hash != expected:
            raise RuntimeError('Live file changed since source review: ' + name)

    release = ROOT / 'releases' / f'{RELEASE_PREFIX}-{commit[:12]}-{RELEASE_DAY}'
    backup = ROOT / 'shared' / f'rollback-{RELEASE_PREFIX}-{commit[:12]}-{RELEASE_DAY}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, indent=2) + '\n')
    (backup / 'container-inventory-before.json').write_text(json.dumps(before_inventory, indent=2) + '\n')
    (backup / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    env = compose_environment(app, files, env_files, backup)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    content = materialize_runtime_files(stage, runtime)
    for name, expected in EXPECTED_PREIMAGES.items():
        target = '/app/' + name
        saved = backup / 'preimages' / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Protected preimage copy changed: ' + name)

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in RUNTIME_FILES]
    overlay = release / 'compose.call-center-inbound-lead-link.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}) + '\n')
    overlay.chmod(0o644)
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'overlay-path.txt').write_text(str(overlay) + '\n')
    deploy_dir = release / 'deploy'
    deploy_dir.mkdir(mode=0o755)
    helper_copy = deploy_dir / Path(HELPER_NAME).name
    helper_copy.write_bytes((Path(stage) / HELPER_NAME).read_bytes())
    helper_copy.chmod(0o644)

    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    from_app = inspect(APP)
    if from_app['Id'] != app['Id']:
        raise RuntimeError('App container changed during Compose validation')
    base_helper_spec = importlib.util.spec_from_file_location('mobile_call_center_base_release_helper', ACTIVE_HELPER)
    base_helper = importlib.util.module_from_spec(base_helper_spec)
    base_helper_spec.loader.exec_module(base_helper)
    verify_live_compose_app(app, before)
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    validate_mount_overlay(before, after, mounts)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during deployment preparation')
    if inventory() != before_inventory:
        raise RuntimeError('Production container inventory changed during deployment preparation')

    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if (current['Image'] != app['Image']
                or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)])):
            raise RuntimeError('App image or Compose chain changed')
        after_inventory = inventory()
        if {name: identity for name, identity in after_inventory.items() if name != APP} != {
                name: identity for name, identity in before_inventory.items() if name != APP}:
            raise RuntimeError('A non-app production container changed')
        for name, data in content.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'appMounts': len(current['Mounts']),
                  'runtimeFiles': len(content), 'hashes': {name: sha(data) for name, data in content.items()},
                  'unchangedNonAppContainers': len(after_inventory) - (1 if APP in after_inventory else 0)}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_production_lock()
    backup = Path(backup).resolve()
    app = inspect(APP)
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    workdir = (backup / 'compose-working-dir.txt').read_text().strip()
    overlay = (backup / 'overlay-path.txt').read_text().strip()
    if app['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [overlay]):
        raise RuntimeError('A later app overlay is active; restore overlays in reverse order')
    hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(not Path(name).is_file() or sha(Path(name).read_bytes()) != digest for name, digest in hashes.items()):
        raise RuntimeError('Prior Compose input changed; refusing an unreviewed rollback')
    prior_inventory = json.loads((backup / 'container-inventory-before.json').read_text())
    current_inventory = inventory()
    prior_support = {name: identity for name, identity in prior_inventory.items() if name != APP}
    if {name: identity for name, identity in current_inventory.items() if name != APP} != prior_support:
        raise RuntimeError('A non-app production container changed since this release')
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, workdir)
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    previous = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != previous['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files):
        raise RuntimeError('Prior app Compose chain did not restore')
    for name, expected in EXPECTED_PREIMAGES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + name)
    if {name: identity for name, identity in inventory().items() if name != APP} != prior_support:
        raise RuntimeError('A non-app production container changed during rollback')
    print(json.dumps({'restoredComposeInputs': len(files), 'image': current['Image'], 'appHealthy': True}))


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(1)
