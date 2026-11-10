#!/usr/bin/env python3
"""Guarded SaleMaX report update for the app and its separate report worker."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
ACTIVE_APP_OVERLAY = '/opt/salemax/releases/pro-catalyst-human-reply-validation-78562bcec95c-20261110/compose.pro-catalyst-human-reply-validation.json'
WORKER_BASE_COMPOSE = '/opt/salemax/releases/business-summary-55b5f11-20261024/deploy/compose.yml'
ACTIVE_WORKER_OVERLAY = '/opt/salemax/releases/training-owner-report-7775551a04ab-20261110/compose.training-owner-report-worker.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
APP = 'salemax-app-1'
WORKER = 'salemax-report-worker-1'
SUPPORT = ('salemax-db-1', 'salemax-libretranslate-1', 'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
EXPECTED_IMAGES = {APP: 'salemax-app:openai-ads-lead-01fde9e1-20261103', WORKER: 'salemax-app:business-summary-55b5f11-20261024'}
APP_FILES = {
    'helper/pipeline/reports.js': '0b40c413fa948125f6ea1dcc2094ee3ab5b04630f4d0ba802c8bbe6ac00d0552',
    'modules/platform/training-report-runner.js': '13b7bf6e04eca0f9312030bb273e305bf3b37a1f8d4cc0b7c6ecf6f34f46b389',
    'modules/platform/training-report-delivery-worker.js': 'd1d786f9c008ed6725bc54bb08c2497a59db2187cd986819c8c824ad268cae9b',
    'client/public/pipeline/reports.js': 'da2eaee6c3a96794fd3e12054fddd074a34f99985d6a1893bed5f91588aeb97a',
    'client/public/pipeline/index.html': 'cddb158d1b061bc75c3a7acd71132e50f69211fa8e65c288a602c310c5acd8bf',
}
WORKER_FILES = {
    'helper/pipeline/reports.js': '0b40c413fa948125f6ea1dcc2094ee3ab5b04630f4d0ba802c8bbe6ac00d0552',
    'modules/platform/training-report-runner.js': '13b7bf6e04eca0f9312030bb273e305bf3b37a1f8d4cc0b7c6ecf6f34f46b389',
    'modules/platform/training-report-delivery-worker.js': 'd1d786f9c008ed6725bc54bb08c2497a59db2187cd986819c8c824ad268cae9b',
}
APP_PREIMAGES = {
    'helper/pipeline/reports.js': '7729da07d9fba47cccc0e0617c52c75836f7955022bc405e0a2c5739dfedede3',
    'modules/platform/training-report-runner.js': '13b7bf6e04eca0f9312030bb273e305bf3b37a1f8d4cc0b7c6ecf6f34f46b389',
    'modules/platform/training-report-delivery-worker.js': 'd1d786f9c008ed6725bc54bb08c2497a59db2187cd986819c8c824ad268cae9b',
    'client/public/pipeline/reports.js': 'da2eaee6c3a96794fd3e12054fddd074a34f99985d6a1893bed5f91588aeb97a',
    'client/public/pipeline/index.html': 'cddb158d1b061bc75c3a7acd71132e50f69211fa8e65c288a602c310c5acd8bf',
}
WORKER_PREIMAGES = {
    'helper/pipeline/reports.js': '7729da07d9fba47cccc0e0617c52c75836f7955022bc405e0a2c5739dfedede3',
    'modules/platform/training-report-runner.js': '13b7bf6e04eca0f9312030bb273e305bf3b37a1f8d4cc0b7c6ecf6f34f46b389',
    'modules/platform/training-report-delivery-worker.js': 'd1d786f9c008ed6725bc54bb08c2497a59db2187cd986819c8c824ad268cae9b',
}
APP_KEYS = ('config_files', 'environment_file', 'working_dir')

def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode})')
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

def service_compose(info, expected_service):
    labels = info['Config']['Labels']
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != expected_service:
        raise RuntimeError('Unexpected Compose service identity')
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not env_files or not all(Path(path).is_file() for path in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return {'files': files, 'env_files': env_files, 'workdir': workdir}

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

def safe_state(info, meta):
    return {'id': info['Id'], 'image': info['Config']['Image'], 'service': info['Config']['Labels'].get('com.docker.compose.service'),
            'project': info['Config']['Labels'].get('com.docker.compose.project'), 'compose': meta,
            'status': info['State'].get('Status'), 'health': info['State'].get('Health', {}).get('Status'), 'restartCount': info['RestartCount']}

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

def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')

def validate_baseline(app, worker, app_meta, worker_meta):
    if app['Config']['Image'] != EXPECTED_IMAGES[APP] or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app health or image differs from reviewed baseline')
    if worker['Config']['Image'] != EXPECTED_IMAGES[WORKER] or worker['State'].get('Status') != 'running':
        raise RuntimeError('Active report worker state or image differs from reviewed baseline')
    if app_meta['files'][-1] != ACTIVE_APP_OVERLAY:
        raise RuntimeError('Active app overlay differs from reviewed baseline')
    if worker_meta['files'] != [WORKER_BASE_COMPOSE, ACTIVE_WORKER_OVERLAY]:
        raise RuntimeError('Active report worker Compose chain differs from reviewed baseline')

def make_mounts(release, names):
    rows=[]
    for name in names:
        rows.append({'type':'bind','source':str(release / 'runtime' / name),'target':'/app/' + name,
                     'read_only':True,'bind':{'create_host_path':False}})
    return rows

def write_overlay(path, service, mounts):
    path.write_text(json.dumps({'services': {service: {'volumes': mounts}}}))
    path.chmod(0o644)

def validate_overlay(common, env, overlay, service, mounts):
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*(common + ['-f', str(overlay)]), 'config', '--format', 'json', env=env))
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

def verify_hashes(service, hashes):
    for name, expected in hashes.items():
        live = run('docker', 'exec', service, 'sha256sum', '/app/' + name).split()[0]
        if live != expected:
            raise RuntimeError('Runtime file hash mismatch: ' + name)

def compose_up(meta, env, overlay, services):
    args = compose_args(meta['files'], meta['env_files'], meta['workdir'])
    if overlay:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', *services]), env=env)

def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    expected_names = set(APP_FILES)
    if not all((stage / name).is_file() for name in expected_names):
        raise RuntimeError('Staging directory is missing reviewed report files')
    os.umask(0o077)
    app, worker = inspect(APP), inspect(WORKER)
    app_meta, worker_meta = service_compose(app, 'app'), service_compose(worker, 'report-worker')
    validate_baseline(app, worker, app_meta, worker_meta)
    for name, expected in APP_PREIMAGES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Live app report file changed: ' + name)
    for name, expected in WORKER_PREIMAGES.items():
        if run('docker', 'exec', WORKER, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Live report-worker file changed: ' + name)
    release = ROOT / 'releases' / f'training-owner-report-{commit[:12]}-20261110'
    backup = ROOT / 'shared' / f'rollback-training-owner-report-{commit[:12]}-20261110'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    backup.mkdir(mode=0o700)
    release.mkdir(mode=0o755)
    app_env, app_vars = compose_environment(app, app_meta)
    worker_env, worker_vars = compose_environment(worker, worker_meta)
    snapshots = {APP: safe_state(app, app_meta), WORKER: safe_state(worker, worker_meta)}
    input_hashes = {name: sha(Path(name).read_bytes()) for name in app_meta['files'] + app_meta['env_files'] + worker_meta['files'] + worker_meta['env_files']}
    (backup / 'services-before.json').write_text(json.dumps(snapshots, indent=2) + '\n')
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, indent=2) + '\n')
    (backup / 'compose-vars.json').write_text(json.dumps({APP: app_vars, WORKER: worker_vars}) + '\n')
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'support-services.json').write_text(json.dumps({name: inspect(name)['Id'] for name in SUPPORT}) + '\n')
    preimage_hashes = {APP: {}, WORKER: {}}
    for service, names in ((APP, APP_FILES), (WORKER, WORKER_FILES)):
        for name in names:
            target = '/app/' + name
            saved = backup / 'preimages' / service / name
            saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            run('docker', 'cp', service + ':' + target, str(saved))
            digest = sha(saved.read_bytes())
            if digest != (APP_PREIMAGES if service == APP else WORKER_PREIMAGES)[name]:
                raise RuntimeError('Rollback preimage hash mismatch: ' + service + ':' + name)
            preimage_hashes[service][name] = digest
    (backup / 'preimage-hashes.json').write_text(json.dumps(preimage_hashes, indent=2) + '\n')

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    data_by_name = {}
    for name in expected_names:
        data = (stage / name).read_bytes()
        target = runtime / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        target.write_bytes(data)
        target.chmod(0o644)
        data_by_name[name] = data
    app_mounts, worker_mounts = make_mounts(release, APP_FILES), make_mounts(release, WORKER_FILES)
    app_overlay = release / 'compose.training-owner-report-app.json'
    worker_overlay = release / 'compose.training-owner-report-worker.json'
    write_overlay(app_overlay, 'app', app_mounts)
    write_overlay(worker_overlay, 'report-worker', worker_mounts)
    app_common = compose_args(app_meta['files'], app_meta['env_files'], app_meta['workdir'])
    worker_common = compose_args(worker_meta['files'], worker_meta['env_files'], worker_meta['workdir'])
    validate_overlay(app_common, app_env, app_overlay, 'app', app_mounts)
    validate_overlay(worker_common, worker_env, worker_overlay, 'report-worker', worker_mounts)
    (release / 'deploy').mkdir(mode=0o755)
    own_helper = release / 'deploy/training-owner-report-release.py'
    own_helper.write_bytes(Path(__file__).read_bytes())
    own_helper.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during preparation')
    if inspect(APP)['Id'] != app['Id'] or inspect(WORKER)['Id'] != worker['Id']:
        raise RuntimeError('A service changed during release preparation')
    before_support = json.loads((backup / 'support-services.json').read_text())
    if any(inspect(name)['Id'] != identity for name, identity in before_support.items()):
        raise RuntimeError('A support service changed during release preparation')
    try:
        compose_up(app_meta, app_env, app_overlay, ['app'])
        current_app = wait_app()
        if current_app['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('App image changed')
        compose_up(worker_meta, worker_env, worker_overlay, ['report-worker'])
        current_worker = wait_worker()
        if current_worker['Config']['Image'] != worker['Config']['Image']:
            raise RuntimeError('Report worker image changed')
        verify_hashes(APP, {name: sha(data) for name, data in data_by_name.items()})
        verify_hashes(WORKER, {name: sha(data_by_name[name]) for name in WORKER_FILES})
        run('docker', 'exec', WORKER, 'node', '-e', "require('/app/helper/pipeline/reports.js');require('/app/modules/platform/training-report-runner.js');require('/app/modules/platform/training-report-delivery-worker.js');process.stdout.write('report modules loaded\\n')")
        if any(inspect(name)['Id'] != identity for name, identity in before_support.items()):
            raise RuntimeError('Support service identity changed')
        app_labels = current_app['Config']['Labels']
        worker_labels = current_worker['Config']['Labels']
        if app_labels['com.docker.compose.project.config_files'].split(',')[-1] != str(app_overlay):
            raise RuntimeError('App overlay is not active')
        if worker_labels['com.docker.compose.project.config_files'].split(',')[-1] != str(worker_overlay):
            raise RuntimeError('Report worker overlay is not active')
        result = {'sourceCommit': commit, 'appRelease': str(release), 'workerRelease': str(release), 'rollback': str(backup),
                  'appImage': current_app['Config']['Image'], 'workerImage': current_worker['Config']['Image'],
                  'appHealth': current_app['State'].get('Health', {}).get('Status'), 'workerState': current_worker['State'].get('Status'),
                  'appFiles': {name: sha(data) for name, data in data_by_name.items()},
                  'workerFiles': {name: sha(data_by_name[name]) for name in WORKER_FILES},
                  'supportServicesUnchanged': True, 'migration': 'none'}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        compose_up(app_meta, app_env, None, ['app'])
        wait_app()
        compose_up(worker_meta, worker_env, None, ['report-worker'])
        wait_worker()
        raise

def restore(backup):
    require_lock()
    backup = Path(backup)
    if (backup / 'base-release.txt').read_text().strip() != BASE:
        raise RuntimeError('Rollback base release differs')
    states = json.loads((backup / 'services-before.json').read_text())
    release = Path((backup / 'release-path.txt').read_text().strip())
    app_overlay, worker_overlay = release / 'compose.training-owner-report-app.json', release / 'compose.training-owner-report-worker.json'
    current_app, current_worker = inspect(APP), inspect(WORKER)
    for info, overlay in ((current_app, app_overlay), (current_worker, worker_overlay)):
        files = info['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
        if not files or files[-1] != str(overlay):
            raise RuntimeError('A later release is active; roll it back first')
    hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in hashes.items()):
        raise RuntimeError('Rollback Compose inputs changed')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    support = json.loads((backup / 'support-services.json').read_text())
    for name, identity in support.items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('A support service changed; refusing rollback')
    app_meta, worker_meta = states[APP]['compose'], states[WORKER]['compose']
    app_env = dict(os.environ, **variables[APP])
    worker_env = dict(os.environ, **variables[WORKER])
    compose_up(app_meta, app_env, None, ['app'])
    restored_app = wait_app()
    compose_up(worker_meta, worker_env, None, ['report-worker'])
    restored_worker = wait_worker()
    for name, current in ((APP, restored_app), (WORKER, restored_worker)):
        if current['Config']['Image'] != states[name]['image']:
            raise RuntimeError('Rollback image mismatch: ' + name)
    for service, names in ((APP, APP_FILES), (WORKER, WORKER_FILES)):
        for name in names:
            expected = sha((backup / 'preimages' / service / name).read_bytes())
            if run('docker', 'exec', service, 'sha256sum', '/app/' + name).split()[0] != expected:
                raise RuntimeError('Rollback file hash mismatch: ' + service + ':' + name)
    if any(inspect(name)['Id'] != identity for name, identity in support.items()):
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
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'TRAINING_OWNER_REPORT_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
