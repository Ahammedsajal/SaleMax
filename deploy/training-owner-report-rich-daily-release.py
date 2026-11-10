#!/usr/bin/env python3
"""Guarded daily PDF and interactive lead-status report overlay."""
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

ROOT = Path('/opt/salemax')
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_APP_OVERLAY = '/opt/salemax/releases/pro-catalyst-reply-quality-0eddb4bf271f-20261110/compose.pro-catalyst-reply-quality.json'
EXPECTED_WORKER_OVERLAY = '/opt/salemax/releases/training-owner-report-collation-fix-ce1719fb9fad-20261110/compose.training-owner-report-worker.json'
APP = 'salemax-app-1'
WORKER = 'salemax-report-worker-1'
SUPPORT = ('salemax-db-1', 'salemax-libretranslate-1', 'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
EXPECTED_IMAGES = {APP: 'salemax-app:openai-ads-lead-01fde9e1-20261103', WORKER: 'salemax-app:business-summary-55b5f11-20261024'}
APP_PREIMAGES = {
    'client/public/pipeline/reports.js': '82ef8d63517063f9f3cdbcbe45aac846a8aed5d8f9e91f1937e3c6cc1d52059e',
    'client/public/pipeline/pipeline.css': 'f03b9427b3ce47e4cc0ad7aac78fb8da5f76950039c04c2972362ec62314bd2b',
    'client/public/pipeline/pipeline-theme.css': '3e1837792fe99646c0ee1cfb79ed0ba81fb4da83b7b629502fcadf4d749ab8db',
    'client/public/pipeline/index.html': '0dbfb7e213ec42ffe122024e1bcf75f4fe926b8f834cb27bacc1011796be1212',
    'helper/pipeline/reports.js': 'e6697cc931d14002b5b170119f0cff0e1f360d5262f932ab4cc0c38fccfe4c8c',
    'modules/platform/business-notifications.js': '49d207446fe93b952247c3ce4c1c644aa59fbc5ec581d49c78778c24ec950531',
    'modules/platform/business-report-pdf.js': '649307e358580964b0335eaae15fea933c4642b2752a25e3e01a6842c91db9e2',
    'modules/platform/training-report-runner.js': 'a90ccd235becccabb48da9b4c1adf58d66aa85a97f156823d4a55201b840ff2e',
    'modules/platform/training-report-delivery-worker.js': 'd1d786f9c008ed6725bc54bb08c2497a59db2187cd986819c8c824ad268cae9b',
    'modules/platform/training-report-qr.js': 'd5fb2de83aac5120a9c079157dd95e360a25666afa901490ca7fcf0e51ac19c9',
}
WORKER_PREIMAGES = {
    'helper/pipeline/reports.js': 'e6697cc931d14002b5b170119f0cff0e1f360d5262f932ab4cc0c38fccfe4c8c',
    'modules/platform/business-notifications.js': '286803a311dad7aa910e7b34e4dc5b990461eb3e3ffb843b2cfac6f5322142e3',
    'modules/platform/business-report-pdf.js': '649307e358580964b0335eaae15fea933c4642b2752a25e3e01a6842c91db9e2',
    'modules/platform/training-report-runner.js': 'a90ccd235becccabb48da9b4c1adf58d66aa85a97f156823d4a55201b840ff2e',
    'modules/platform/training-report-delivery-worker.js': '67a92d9ea8f05f31de1b39e02d007b900a4fef02e52b9f4412f3c291b25466a7',
    'modules/platform/training-report-qr.js': 'd5fb2de83aac5120a9c079157dd95e360a25666afa901490ca7fcf0e51ac19c9',
}
APP_NEW_FILES = ('modules/platform/training-report-pdf.js',)
WORKER_NEW_FILES = ('modules/platform/training-report-pdf.js',)
APP_FILES = tuple(APP_PREIMAGES) + APP_NEW_FILES
WORKER_FILES = tuple(WORKER_PREIMAGES) + WORKER_NEW_FILES
STAGED_APP_FILES = APP_FILES
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode})')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def service_compose(info, service):
    labels = info['Config']['Labels']
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != service:
        raise RuntimeError('Unexpected Compose service identity')
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not env_files or not all(Path(path).is_file() for path in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return {'files': files, 'env_files': env_files, 'workdir': workdir}


def compose_args(meta):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', meta['workdir']]
    for name in meta['env_files']:
        args += ['--env-file', name]
    for name in meta['files']:
        args += ['-f', name]
    return args


def compose_environment(info, meta):
    live = dict(item.split('=', 1) for item in info['Config'].get('Env', []) if '=' in item)
    supplied = {key for name in meta['env_files'] for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in meta['files'] for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    manual = json.loads(PRIOR_VARS.read_text()) if PRIOR_VARS.is_file() else {}
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live:
            variables[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation input')
    return dict(os.environ, **variables), variables


def mount_rows(release, names):
    return [{'type': 'bind', 'source': str(release / 'runtime' / name), 'target': '/app/' + name,
             'read_only': True, 'bind': {'create_host_path': False}} for name in names]


def write_overlay(path, service, mounts):
    path.write_text(json.dumps({'services': {service: {'volumes': mounts}}}))
    path.chmod(0o644)


def validate_overlay(meta, env, overlay, service, mounts):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(common + ['-f', str(overlay), 'config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Candidate Compose changes the service set')
    old = before['services'][service]
    new = after['services'][service]
    old_volumes = {row['target']: row for row in old.get('volumes', [])}
    expected = dict(old_volumes, **{row['target']: row for row in mounts})
    new_volumes = {row['target']: row for row in new.get('volumes', [])}
    if set(new_volumes) != set(expected):
        raise RuntimeError('Candidate Compose has unexpected mount targets')
    for target, row in new_volumes.items():
        want = expected[target]
        if (row['type'], row.get('source'), row.get('read_only')) != (want['type'], want.get('source'), want.get('read_only')):
            raise RuntimeError('Candidate Compose has an unexpected mount')
    before_copy, after_copy = copy.deepcopy(before), copy.deepcopy(after)
    for document in (before_copy, after_copy):
        document['services'][service].pop('volumes', None)
    if before_copy != after_copy:
        raise RuntimeError('Candidate Compose changes service configuration beyond reviewed mounts')


def wait_app():
    for _ in range(45):
        info = inspect(APP)
        if info['State'].get('Health', {}).get('Status') == 'healthy':
            return info
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def wait_worker():
    for _ in range(30):
        info = inspect(WORKER)
        if info['State'].get('Status') == 'running':
            return info
        time.sleep(2)
    raise RuntimeError('Report worker did not start')


def compose_up(meta, env, overlay, service):
    args = compose_args(meta)
    if overlay:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', service]), env=env)


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or base release changed')


def verify_files(service, hashes):
    for name, expected in hashes.items():
        live = run('docker', 'exec', service, 'sha256sum', '/app/' + name).split()[0]
        if live != expected:
            raise RuntimeError('Runtime file hash mismatch: ' + name)


def verify_absent(service, names):
    for name in names:
        result = subprocess.run(['docker', 'exec', service, 'test', '!', '-e', '/app/' + name], capture_output=True)
        if result.returncode:
            raise RuntimeError('Expected new runtime file to be absent before release: ' + name)


def support_ids():
    return {name: inspect(name)['Id'] for name in SUPPORT}


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    expected = set(STAGED_APP_FILES + WORKER_FILES)
    if not all((stage / name).is_file() and not (stage / name).is_symlink() for name in expected):
        raise RuntimeError('Staging directory is missing reviewed report files')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')
    os.umask(0o077)
    app, worker = inspect(APP), inspect(WORKER)
    app_meta, worker_meta = service_compose(app, 'app'), service_compose(worker, 'report-worker')
    if app['Config']['Image'] != EXPECTED_IMAGES[APP] or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app health or image differs from reviewed baseline')
    if worker['Config']['Image'] != EXPECTED_IMAGES[WORKER] or worker['State'].get('Status') != 'running':
        raise RuntimeError('Active report worker state or image differs from reviewed baseline')
    if app_meta['files'][-1] != EXPECTED_APP_OVERLAY or worker_meta['files'][-1] != EXPECTED_WORKER_OVERLAY:
        raise RuntimeError('A newer app or report-worker overlay is active')
    verify_files(APP, APP_PREIMAGES)
    verify_files(WORKER, WORKER_PREIMAGES)
    verify_absent(APP, APP_NEW_FILES)
    verify_absent(WORKER, WORKER_NEW_FILES)
    release = ROOT / 'releases' / f'training-owner-report-rich-daily-{commit[:12]}-20261110'
    backup = ROOT / 'shared' / f'rollback-training-owner-report-rich-daily-{commit[:12]}-20261110'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    backup.mkdir(mode=0o700)
    release.mkdir(mode=0o755)
    app_env, app_vars = compose_environment(app, app_meta)
    worker_env, worker_vars = compose_environment(worker, worker_meta)
    states = {APP: {'id': app['Id'], 'image': app['Config']['Image'], 'compose': app_meta},
              WORKER: {'id': worker['Id'], 'image': worker['Config']['Image'], 'compose': worker_meta}}
    inputs = sorted(set(app_meta['files'] + app_meta['env_files'] + worker_meta['files'] + worker_meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    (backup / 'services-before.json').write_text(json.dumps(states, indent=2) + '\n')
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, indent=2) + '\n')
    (backup / 'compose-vars.json').write_text(json.dumps({APP: app_vars, WORKER: worker_vars}) + '\n')
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    support = support_ids()
    (backup / 'support-services.json').write_text(json.dumps(support, indent=2) + '\n')
    preimages = {}
    for service, names in ((APP, APP_FILES), (WORKER, WORKER_FILES)):
        for name in names:
            if name in (APP_NEW_FILES if service == APP else WORKER_NEW_FILES):
                continue
            saved = backup / 'preimages' / service / name
            saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            run('docker', 'cp', service + ':/app/' + name, str(saved))
            digest = sha(saved.read_bytes())
            expected_hash = (APP_PREIMAGES if service == APP else WORKER_PREIMAGES)[name]
            if digest != expected_hash:
                raise RuntimeError('Rollback preimage hash mismatch: ' + service + ':' + name)
            preimages.setdefault(service, {})[name] = digest
    (backup / 'preimage-hashes.json').write_text(json.dumps(preimages, indent=2) + '\n')
    (backup / 'preimage-absent-files.json').write_text(json.dumps({APP: list(APP_NEW_FILES), WORKER: list(WORKER_NEW_FILES)}, indent=2) + '\n')
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    contents = {}
    for name in APP_FILES + WORKER_FILES:
        data = (stage / name).read_bytes()
        target = runtime / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        target.write_bytes(data)
        target.chmod(0o644)
        contents[name] = data
    app_overlay, worker_overlay = release / 'compose.training-owner-report-app.json', release / 'compose.training-owner-report-worker.json'
    write_overlay(app_overlay, 'app', mount_rows(release, APP_FILES))
    write_overlay(worker_overlay, 'report-worker', mount_rows(release, WORKER_FILES))
    validate_overlay(app_meta, app_env, app_overlay, 'app', mount_rows(release, APP_FILES))
    validate_overlay(worker_meta, worker_env, worker_overlay, 'report-worker', mount_rows(release, WORKER_FILES))
    own_helper = release / 'deploy/training-owner-report-rich-daily-release.py'
    own_helper.parent.mkdir(mode=0o755)
    own_helper.write_bytes(Path(__file__).read_bytes())
    own_helper.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during preparation')
    if inspect(APP)['Id'] != app['Id'] or inspect(WORKER)['Id'] != worker['Id'] or support_ids() != support:
        raise RuntimeError('A service changed during release preparation')
    try:
        compose_up(app_meta, app_env, app_overlay, 'app')
        current_app = wait_app()
        compose_up(worker_meta, worker_env, worker_overlay, 'report-worker')
        current_worker = wait_worker()
        verify_files(APP, {name: sha(contents[name]) for name in APP_FILES})
        verify_files(WORKER, {name: sha(contents[name]) for name in WORKER_FILES})
        module_check = "require('/app/helper/pipeline/reports.js');require('/app/modules/platform/business-notifications.js');require('/app/modules/platform/business-report-pdf.js');require('/app/modules/platform/training-report-pdf.js');require('/app/modules/platform/training-report-runner.js');require('/app/modules/platform/training-report-delivery-worker.js');require('/app/modules/platform/training-report-qr.js');process.stdout.write('report modules loaded\\n')"
        run('docker', 'exec', APP, 'node', '-e', module_check)
        run('docker', 'exec', WORKER, 'node', '-e', module_check)
        if support_ids() != support:
            raise RuntimeError('A support service identity changed')
        if current_app['Config']['Image'] != app['Config']['Image'] or current_worker['Config']['Image'] != worker['Config']['Image']:
            raise RuntimeError('A service image changed')
        if current_app['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(app_overlay):
            raise RuntimeError('App overlay is not active')
        if current_worker['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(worker_overlay):
            raise RuntimeError('Report-worker overlay is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        app_chain = current_app['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appImage': current_app['Config']['Image'], 'workerImage': current_worker['Config']['Image'],
                  'appHealth': current_app['State'].get('Health', {}).get('Status'), 'workerState': current_worker['State'].get('Status'),
                  'appFiles': {name: sha(contents[name]) for name in APP_FILES},
                  'workerFiles': {name: sha(contents[name]) for name in WORKER_FILES},
                  'appComposeInputs': len(app_chain), 'supportServicesUnchanged': True, 'migration': 'none', 'healthz': '200'}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        compose_up(app_meta, app_env, None, 'app')
        wait_app()
        compose_up(worker_meta, worker_env, None, 'report-worker')
        wait_worker()
        raise


def restore(backup):
    require_lock()
    backup = Path(backup)
    if (backup / 'base-release.txt').read_text().strip() != BASE:
        raise RuntimeError('Rollback base release differs')
    states = json.loads((backup / 'services-before.json').read_text())
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlays = (release / 'compose.training-owner-report-app.json', release / 'compose.training-owner-report-worker.json')
    current = {APP: inspect(APP), WORKER: inspect(WORKER)}
    for service, overlay in zip((APP, WORKER), overlays):
        files = current[service]['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
        if not files or files[-1] != str(overlay):
            raise RuntimeError('A later release is active; roll it back first')
    inputs = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in inputs.items()):
        raise RuntimeError('Rollback Compose inputs changed')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('A support service changed; refusing rollback')
    for service in (APP, WORKER):
        meta = states[service]['compose']
        env = dict(os.environ, **variables[service])
        compose_up(meta, env, None, 'app' if service == APP else 'report-worker')
        restored = wait_app() if service == APP else wait_worker()
        if restored['Config']['Image'] != states[service]['image']:
            raise RuntimeError('Rollback image mismatch: ' + service)
    for service, names in ((APP, APP_FILES), (WORKER, WORKER_FILES)):
        verify_files(service, json.loads((backup / 'preimage-hashes.json').read_text())[service])
    absent = json.loads((backup / 'preimage-absent-files.json').read_text())
    for service in (APP, WORKER):
        verify_absent(service, absent[service])
    if support_ids() != support:
        raise RuntimeError('Rollback changed a support service')
    print(json.dumps({'rolledBack': str(release), 'appHealth': 'healthy', 'reportWorkerState': 'running', 'supportServicesUnchanged': True}))


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
            deploy(Path(sys.argv[2]), sys.argv[3])
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(Path(sys.argv[2]))
        else:
            raise RuntimeError('Usage: deploy <stage> <commit> | restore <backup>')
    except Exception as error:
        message = str(error)
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'TRAINING_OWNER_REPORT_MESSAGE_PDF_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
