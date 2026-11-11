#!/usr/bin/env python3
"""Guarded app/worker overlay for the canonical 7Network Pipeline URL."""
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
APP = 'salemax-app-1'
WORKER = 'salemax-report-worker-1'
SUPPORT = ('salemax-db-1', 'salemax-libretranslate-1', 'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
EXPECTED_IMAGES = {APP: 'salemax-app:openai-ads-lead-01fde9e1-20261103', WORKER: 'salemax-app:business-summary-55b5f11-20261024'}
EXPECTED_APP_HEAD = '/opt/salemax/releases/pipeline-follow-up-assignment-4eb0f60d4bd7-20261111/compose.pipeline-follow-up-assignment-app.json'
EXPECTED_WORKER_HEAD = '/opt/salemax/releases/pipeline-follow-up-assignment-4eb0f60d4bd7-20261111/compose.pipeline-follow-up-assignment-worker.json'
TARGET = 'modules/platform/pipeline-follow-up-assignment.js'
EXPECTED_PREIMAGE = '1470adeca4eb5eeeebcac1cc67b872f622134bafa3c9798a8f741ebb31d74ec4'
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'


def run(*args, env=None, input_text=None):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode})')
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_output(output):
    for line in reversed(output.splitlines()):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            pass
    raise RuntimeError('Command output did not contain JSON')


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


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
    manual = json.loads(MANUAL_VARS.read_text()) if MANUAL_VARS.is_file() else {}
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live:
            variables[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation input')
    return dict(os.environ, **variables), variables


def support_ids():
    return {name: inspect(name)['Id'] for name in SUPPORT}


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or base release changed')


def compose_up(meta, env, overlay, service):
    args = compose_args(meta)
    if overlay:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', service]), env=env)


def wait_service(name):
    for _ in range(45):
        info = inspect(name)
        if name == APP and info['State'].get('Health', {}).get('Status') == 'healthy':
            return info
        if name == WORKER and info['State'].get('Status') == 'running':
            return info
        time.sleep(2)
    raise RuntimeError('Service health did not recover')


def verify_compose_overlay(meta, env, overlay, service, mount):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(common + ['-f', str(overlay), 'config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Candidate Compose changes the service set')
    before_copy, after_copy = copy.deepcopy(before), copy.deepcopy(after)
    old = before_copy['services'][service]
    new = after_copy['services'][service]
    old_volumes = {row['target']: row for row in old.get('volumes', [])}
    expected = dict(old_volumes, **{mount['target']: mount})
    actual = {row['target']: row for row in new.get('volumes', [])}
    if set(actual) != set(expected):
        raise RuntimeError('Candidate Compose has unexpected mount targets')
    for target, row in actual.items():
        want = expected[target]
        if (row['type'], row.get('source'), row.get('read_only')) != (want['type'], want.get('source'), want.get('read_only')):
            raise RuntimeError('Candidate Compose has an unexpected mount')
    for document in (before_copy, after_copy):
        document['services'][service].pop('volumes', None)
    if before_copy != after_copy:
        raise RuntimeError('Candidate Compose changes service configuration beyond the reviewed mount')


def verify_runtime(contents):
    for service in (APP, WORKER):
        live = run('docker', 'exec', service, 'sha256sum', '/app/' + TARGET).split()[0]
        if live != sha(contents):
            raise RuntimeError('Runtime follow-up module hash mismatch')
    run('docker', 'exec', APP, 'node', '-e', "require('/app/modules/platform/pipeline-follow-up-assignment.js');process.exit(0)")
    run('docker', 'exec', WORKER, 'node', '-e', "require('/app/modules/platform/pipeline-follow-up-assignment.js');process.exit(0)")


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    source = stage / TARGET
    if not source.is_file() or source.is_symlink():
        raise RuntimeError('Staging directory is missing the follow-up module')
    contents = source.read_bytes()
    app, worker = inspect(APP), inspect(WORKER)
    app_meta, worker_meta = service_compose(app, 'app'), service_compose(worker, 'report-worker')
    if app['Config']['Image'] != EXPECTED_IMAGES[APP] or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app state differs from the reviewed baseline')
    if worker['Config']['Image'] != EXPECTED_IMAGES[WORKER] or worker['State'].get('Status') != 'running':
        raise RuntimeError('Active report-worker state differs from the reviewed baseline')
    if app_meta['files'][-1] != EXPECTED_APP_HEAD or worker_meta['files'][-1] != EXPECTED_WORKER_HEAD:
        raise RuntimeError('A newer app or report-worker overlay is active')
    if run('docker', 'exec', APP, 'sha256sum', '/app/' + TARGET).split()[0] != EXPECTED_PREIMAGE:
        raise RuntimeError('Active app module differs from the reviewed preimage')
    if run('docker', 'exec', WORKER, 'sha256sum', '/app/' + TARGET).split()[0] != EXPECTED_PREIMAGE:
        raise RuntimeError('Active worker module differs from the reviewed preimage')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')
    os.umask(0o077)
    release = ROOT / 'releases' / f'pipeline-follow-up-assignment-domain-{commit[:12]}-20261111'
    backup = ROOT / 'shared' / f'rollback-pipeline-follow-up-assignment-domain-{commit[:12]}-20261111'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    app_env, app_vars = compose_environment(app, app_meta)
    worker_env, worker_vars = compose_environment(worker, worker_meta)
    states = {APP: {'id': app['Id'], 'image': app['Config']['Image'], 'compose': app_meta},
              WORKER: {'id': worker['Id'], 'image': worker['Config']['Image'], 'compose': worker_meta}}
    inputs = sorted(set(app_meta['files'] + app_meta['env_files'] + worker_meta['files'] + worker_meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    preimage_dir = backup / 'preimages'
    preimage_dir.mkdir(mode=0o700)
    for service in (APP, WORKER):
        run('docker', 'cp', service + ':/app/' + TARGET, str(preimage_dir / (service + '.js')))
        if sha((preimage_dir / (service + '.js')).read_bytes()) != EXPECTED_PREIMAGE:
            raise RuntimeError('Rollback preimage hash mismatch')
    snapshots = {
        'services-before.json': states,
        'compose-input-hashes.json': input_hashes,
        'compose-vars.json': {APP: app_vars, WORKER: worker_vars},
        'support-services.json': support_ids(),
        'release-path.txt': str(release) + '\n',
        'base-release.txt': BASE + '\n',
        'preimage-hashes.json': {APP: EXPECTED_PREIMAGE, WORKER: EXPECTED_PREIMAGE},
    }
    for filename, value in snapshots.items():
        target = backup / filename
        target.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
        target.chmod(0o600)
    runtime = release / 'runtime' / TARGET
    runtime.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    runtime.write_bytes(contents)
    runtime.chmod(0o644)
    overlays = {}
    for service, meta, env in ((APP, app_meta, app_env), (WORKER, worker_meta, worker_env)):
        overlay = release / ('compose.follow-up-domain-app.json' if service == APP else 'compose.follow-up-domain-worker.json')
        mount = {'type': 'bind', 'source': str(runtime), 'target': '/app/' + TARGET,
                 'read_only': True, 'bind': {'create_host_path': False}}
        overlay.write_text(json.dumps({'services': {('app' if service == APP else 'report-worker'): {'volumes': [mount]}}}))
        overlay.chmod(0o644)
        verify_compose_overlay(meta, env, overlay, 'app' if service == APP else 'report-worker', mount)
        overlays[service] = overlay
    helper_path = release / 'deploy' / 'pipeline-follow-up-assignment-domain-release.py'
    helper_path.parent.mkdir(mode=0o755)
    helper_path.write_bytes(Path(__file__).read_bytes())
    helper_path.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during preparation')
    if inspect(APP)['Id'] != app['Id'] or inspect(WORKER)['Id'] != worker['Id']:
        raise RuntimeError('A service changed during release preparation')
    support = snapshots['support-services.json']
    try:
        compose_up(app_meta, app_env, overlays[APP], 'app')
        current_app = wait_service(APP)
        compose_up(worker_meta, worker_env, overlays[WORKER], 'report-worker')
        current_worker = wait_service(WORKER)
        verify_runtime(contents)
        if support_ids() != support:
            raise RuntimeError('A support service identity changed')
        if current_app['Config']['Image'] != app['Config']['Image'] or current_worker['Config']['Image'] != worker['Config']['Image']:
            raise RuntimeError('Service image changed')
        if current_app['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlays[APP]):
            raise RuntimeError('App overlay is not active')
        if current_worker['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlays[WORKER]):
            raise RuntimeError('Report-worker overlay is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        route_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/user?page=pipeline').strip()
        api_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/api/workspace/pipeline/reports/follow-up-assignment').strip()
        if route_status != '200' or api_status != '401':
            raise RuntimeError('Public route or API authentication verification failed')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appHealth': current_app['State'].get('Health', {}).get('Status'), 'workerState': current_worker['State'].get('Status'),
                  'moduleSha256': sha(contents), 'appOverlay': str(overlays[APP]), 'workerOverlay': str(overlays[WORKER]),
                  'supportServicesUnchanged': True, 'healthz': '200', 'pipelineRoute': route_status, 'anonymousAssignmentApi': api_status,
                  'migration': 'none'}
        result_path = backup / 'result.json'
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        result_path.chmod(0o600)
        print(json.dumps(result))
    except Exception as error:
        try:
            (backup / 'deployment-failure.txt').write_text(f'{type(error).__name__}: {error}\n')
        except Exception:
            pass
        for service in (APP, WORKER):
            meta = states[service]['compose']
            env = dict(os.environ, **(app_vars if service == APP else worker_vars))
            compose_up(meta, env, None, 'app' if service == APP else 'report-worker')
            wait_service(service)
        raise


def restore(backup):
    require_lock()
    backup = Path(backup)
    if (backup / 'base-release.txt').read_text().strip() != BASE:
        raise RuntimeError('Rollback base release differs')
    states = json.loads((backup / 'services-before.json').read_text())
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlays = (release / 'compose.follow-up-domain-app.json', release / 'compose.follow-up-domain-worker.json')
    for service, overlay in zip((APP, WORKER), overlays):
        files = inspect(service)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
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
        restored = wait_service(service)
        if restored['Config']['Image'] != states[service]['image']:
            raise RuntimeError('Rollback image mismatch')
        live_hash = run('docker', 'exec', service, 'sha256sum', '/app/' + TARGET).split()[0]
        if live_hash != EXPECTED_PREIMAGE:
            raise RuntimeError('Rollback module hash mismatch')
    if support_ids() != support:
        raise RuntimeError('Rollback changed a support service')
    print(json.dumps({'rolledBack': str(release), 'appHealth': 'healthy', 'workerState': 'running', 'supportServicesUnchanged': True}))


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
            deploy(Path(sys.argv[2]), sys.argv[3])
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(Path(sys.argv[2]))
        else:
            raise RuntimeError('Usage: deploy <stage> <commit> | restore <rollback-directory>')
    except Exception as error:
        message = str(error)
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'PIPELINE_FOLLOW_UP_DOMAIN_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
