#!/usr/bin/env python3
"""Bound production database pools and release retained idle sessions."""
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
DB = 'salemax-db-1'
EXPECTED_IMAGE = 'salemax-app:openai-ads-lead-01fde9e1-20261103'
EXPECTED_HEAD = '/opt/salemax/releases/pipeline-show-all-leads-28d21c99df43-20261111/compose.pipeline-show-all-leads.json'
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
FILES = ('database/config.js', 'functions/function.js', 'routes/web.js')
PREIMAGES = {
    'database/config.js': '59fac9ac7294aae93cfc0dccd6a107453cbee2006272f6c43ce41f15494b49f5',
    'functions/function.js': 'ae8e7a8393d265c8578a7f49d9453ddffd6ee830688257e5a207454661ffe6b1',
    'routes/web.js': 'cd8d01dd1997f9b53be12f2fc10950e94cb12bde32c5e0bafd4d2b1ac241dc98',
}
SERVICES = {
    'app': {'container': APP, 'connectionLimit': '100', 'maxIdle': '30'},
    'report-worker': {'container': 'salemax-report-worker-1', 'connectionLimit': '15', 'maxIdle': '5'},
    'recruitment-founder-notification-worker': {
        'container': 'salemax-recruitment-founder-notification-worker-1',
        'connectionLimit': '5', 'maxIdle': '2',
    },
}
SERVICE_NAMES = tuple(SERVICES)
AFFECTED_CONTAINERS = tuple(item['container'] for item in SERVICES.values())
SUPPORT = ('salemax-db-1', 'salemax-libretranslate-1', 'salemax-bot-lead-test-db')
IDLE_TIMEOUT_MS = '60000'


def run(*args, env=None, input_text=None, timeout=None):
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


def service_compose(info, service):
    labels = info.get('Config', {}).get('Labels') or {}
    if (labels.get('com.docker.compose.project') != 'salemax'
            or labels.get('com.docker.compose.service') != service):
        raise RuntimeError('Unexpected Compose service identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if not workdir or not files or not env_files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return {'files': files, 'env_files': env_files, 'workdir': workdir}


def compose_args(meta):
    args = ['docker', 'compose', '--project-name', 'salemax',
            '--project-directory', meta['workdir']]
    for name in meta['env_files']:
        args += ['--env-file', name]
    for name in meta['files']:
        args += ['-f', name]
    return args


def compose_environment(info, meta):
    live = dict(item.split('=', 1) for item in info['Config'].get('Env', []) if '=' in item)
    supplied = {key for name in meta['env_files']
                for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in meta['files']
                  for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    manual = json.loads(MANUAL_VARS.read_text()) if MANUAL_VARS.is_file() else {}
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live:
            variables[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation input')
    effective = dict(os.environ)
    for key in referenced:
        effective.pop(key, None)
    effective.update(variables)
    return effective, variables


def support_ids():
    return {name: inspect(name)['Id'] for name in SUPPORT}


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or base release changed')


def compose_up(meta, env, overlay, services=SERVICE_NAMES):
    args = compose_args(meta)
    if overlay:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', *services]),
        env=env, timeout=300)


def wait_app(timeout_seconds=180):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        info = inspect(APP)
        if (info['State'].get('Status') == 'running'
                and info['State'].get('Health', {}).get('Status') == 'healthy'):
            return info
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def wait_workers(timeout_seconds=120):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        rows = [inspect(SERVICES[name]['container']) for name in SERVICE_NAMES[1:]]
        if all(row['State'].get('Status') == 'running' for row in rows):
            return rows
        time.sleep(2)
    raise RuntimeError('A database worker did not recover')


def wait_database_health(timeout_seconds=180):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        info = inspect(DB)
        if info['State'].get('Health', {}).get('Status') == 'healthy':
            return info
        if info['State'].get('Status') != 'running':
            raise RuntimeError('Database container stopped during recovery')
        time.sleep(3)
    return inspect(DB)


def container_hash(container, name):
    return run('docker', 'exec', container, 'sha256sum', '/app/' + name).split()[0]


def env_map(value):
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, list):
        output = {}
        for item in value:
            key, separator, content = item.partition('=')
            output[key] = content if separator else None
        return output
    return {}


def volume_map(value):
    return {row['target']: row for row in value or []}


def verify_overlay(meta, env, overlay, release):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(common + ['-f', str(overlay), 'config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Pool overlay changes the service set')
    for service, settings in SERVICES.items():
        old = copy.deepcopy(before['services'][service])
        new = copy.deepcopy(after['services'][service])
        old_env, new_env = env_map(old.pop('environment', {})), env_map(new.pop('environment', {}))
        expected_env = dict(old_env)
        expected_env.update({
            'DB_POOL_LIMIT': settings['connectionLimit'],
            'DB_POOL_MAX_IDLE': settings['maxIdle'],
            'DB_POOL_IDLE_TIMEOUT_MS': IDLE_TIMEOUT_MS,
        })
        if new_env != expected_env:
            raise RuntimeError('Pool overlay changes unreviewed service environment')
        old_volumes = volume_map(old.pop('volumes', []))
        new_volumes = volume_map(new.pop('volumes', []))
        expected_volumes = dict(old_volumes)
        config_target = '/app/database/config.js'
        if config_target in old_volumes:
            raise RuntimeError('Database config already has a production mount')
        expected_volumes[config_target] = {
            'type': 'bind', 'source': str(release / 'runtime/database/config.js'),
            'target': config_target, 'read_only': True,
            'bind': {'create_host_path': False},
        }
        if service == 'app':
            for name in ('functions/function.js', 'routes/web.js'):
                target = '/app/' + name
                if target in old_volumes:
                    raise RuntimeError('Pool fix target already has a production mount')
                expected_volumes[target] = {
                    'type': 'bind', 'source': str(release / 'runtime' / name),
                    'target': target, 'read_only': True,
                    'bind': {'create_host_path': False},
                }
        for target, wanted in expected_volumes.items():
            actual = new_volumes.get(target)
            if not actual or (actual.get('type'), actual.get('source'), actual.get('read_only')) != (
                    wanted.get('type'), wanted.get('source'), wanted.get('read_only')):
                raise RuntimeError('Pool overlay changes an unreviewed bind mount')
        if set(new_volumes) != set(expected_volumes):
            raise RuntimeError('Pool overlay changes an unreviewed mount target')
        if old != new:
            raise RuntimeError('Pool overlay changes other service configuration')
    for service in set(before['services']) - set(SERVICES):
        if before['services'][service] != after['services'][service]:
            raise RuntimeError('Pool overlay changes an unrelated service')


def health_failure_is_connection_limit(db):
    health = db.get('State', {}).get('Health') or {}
    if health.get('Status') != 'unhealthy':
        return False
    logs = health.get('Log') or []
    return any('too many connections' in str(item.get('Output', '')).lower()
               for item in logs[-5:])


def tcp_connection_counts():
    raw = run('docker', 'exec', DB, 'cat', '/proc/net/tcp', '/proc/net/tcp6')
    counts = {'established': 0, 'other': 0}
    for line in raw.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 4 and fields[1].rsplit(':', 1)[-1].upper() == '0CEA':
            if fields[3] == '01':
                counts['established'] += 1
            else:
                counts['other'] += 1
    return counts


def check_public_routes():
    health = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
                 'https://7network.live/healthz', timeout=30).strip()
    user = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
               'https://7network.live/user?page=campaign-dashboard', timeout=30).strip()
    if health != '200' or user != '200':
        raise RuntimeError('Public health or user route verification failed')
    return {'healthz': health, 'userRoute': user}


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    manifest_path = stage / 'manifest.json'
    if not manifest_path.is_file():
        raise RuntimeError('Staging manifest is missing')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or manifest.get('files') != list(FILES):
        raise RuntimeError('Staging manifest does not match the requested source commit')
    contents = {}
    for name in FILES:
        path = stage / name
        if not path.is_file() or path.is_symlink():
            raise RuntimeError('Staging directory is missing a reviewed database pool file')
        data = path.read_bytes()
        if manifest.get('sha256', {}).get(name) != sha(data):
            raise RuntimeError('Staging file hash differs from its manifest')
        contents[name] = data

    app = inspect(APP)
    db = inspect(DB)
    worker_infos = {name: inspect(settings['container']) for name, settings in SERVICES.items()
                    if name != 'app'}
    if (app['Config']['Image'] != EXPECTED_IMAGE
            or app['State'].get('Status') != 'running'
            or app['State'].get('Health', {}).get('Status') != 'healthy'):
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if db['State'].get('Status') != 'running':
        raise RuntimeError('Database container is not running')
    if (db['State'].get('Health', {}).get('Status') != 'healthy'
            and not health_failure_is_connection_limit(db)):
        raise RuntimeError('Database is unhealthy for a reason outside the reviewed pool issue')
    for service, info in worker_infos.items():
        if (info['State'].get('Status') != 'running'
                or info['Config'].get('Labels', {}).get('com.docker.compose.service') != service):
            raise RuntimeError('A database worker is not the reviewed running service')

    meta = service_compose(app, 'app')
    if meta['files'][-1] != EXPECTED_HEAD:
        raise RuntimeError('A newer app overlay is active')
    if shutil.disk_usage(ROOT).free < 64 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')
    for name, expected in PREIMAGES.items():
        if container_hash(APP, name) != expected:
            raise RuntimeError('Active app file differs from the reviewed pool preimage')
    for service, info in worker_infos.items():
        if container_hash(SERVICES[service]['container'], 'database/config.js') != PREIMAGES['database/config.js']:
            raise RuntimeError('Database worker config differs from the reviewed pool preimage')
    active = {APP: app, **{SERVICES[name]['container']: info for name, info in worker_infos.items()}}
    for container, info in active.items():
        if any(mount.get('Destination') == '/app/database/config.js' for mount in info.get('Mounts', [])):
            raise RuntimeError('Database config already has an active production mount')
    env, variables = compose_environment(app, meta)
    support = support_ids()
    initial_ids = {name: info['Id'] for name, info in active.items()}
    inputs = sorted(set(meta['files'] + meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    date = time.strftime('%Y%m%d', time.gmtime())
    release = ROOT / 'releases' / f'database-pool-budget-{commit[:12]}-{date}'
    backup = ROOT / 'shared' / f'rollback-database-pool-budget-{commit[:12]}-{date}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    for name, expected in PREIMAGES.items():
        runtime = release / 'runtime' / name
        runtime.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        runtime.write_bytes(contents[name])
        runtime.chmod(0o644)
        saved = backup / 'preimages' / 'app' / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        run('docker', 'cp', f'{APP}:/app/{name}', str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('App rollback preimage hash mismatch')
    for service in SERVICE_NAMES[1:]:
        worker_preimage = backup / 'preimages' / service / 'database/config.js'
        worker_preimage.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        run('docker', 'cp', f"{SERVICES[service]['container']}:/app/database/config.js",
            str(worker_preimage))
        if sha(worker_preimage.read_bytes()) != PREIMAGES['database/config.js']:
            raise RuntimeError('Worker rollback preimage hash mismatch')

    overlay = release / 'compose.database-pool-recovery.json'
    service_overlay = {}
    runtime_config = release / 'runtime/database/config.js'
    for service, settings in SERVICES.items():
        volumes = [{'type': 'bind', 'source': str(runtime_config),
                    'target': '/app/database/config.js', 'read_only': True,
                    'bind': {'create_host_path': False}}]
        if service == 'app':
            for name in ('functions/function.js', 'routes/web.js'):
                volumes.append({'type': 'bind', 'source': str(release / 'runtime' / name),
                                'target': '/app/' + name, 'read_only': True,
                                'bind': {'create_host_path': False}})
        service_overlay[service] = {
            'volumes': volumes,
            'environment': {
                'DB_POOL_LIMIT': settings['connectionLimit'],
                'DB_POOL_MAX_IDLE': settings['maxIdle'],
                'DB_POOL_IDLE_TIMEOUT_MS': IDLE_TIMEOUT_MS,
            },
        }
    overlay.write_text(json.dumps({'services': service_overlay}, indent=2) + '\n')
    overlay.chmod(0o644)
    verify_overlay(meta, env, overlay, release)
    helper_copy = release / 'deploy' / 'database-pool-recovery-release.py'
    helper_copy.parent.mkdir(mode=0o755)
    helper_copy.write_bytes(Path(__file__).read_bytes())
    helper_copy.chmod(0o644)

    write_private(backup / 'app-before.json', app)
    for service, info in worker_infos.items():
        write_private(backup / f'{service}-before.json', info)
    write_private(backup / 'compose-meta.json', meta)
    write_private(backup / 'compose-vars.json', variables)
    write_private(backup / 'compose-input-hashes.json', input_hashes)
    write_private(backup / 'support-services.json', support)
    write_private(backup / 'service-ids-before.json', initial_ids)
    write_private(backup / 'preimage-hashes.json', PREIMAGES)
    write_private(backup / 'source-commit.txt', commit + '\n')
    write_private(backup / 'release-path.txt', str(release) + '\n')
    release_info = {
        'sourceCommit': commit, 'baseRelease': BASE, 'baseImage': EXPECTED_IMAGE,
        'release': str(release), 'overlay': str(overlay), 'rollback': str(backup),
        'files': {name: sha(data) for name, data in contents.items()},
        'poolBudgets': {name: {key: value for key, value in settings.items()
                               if key != 'container'} | {'idleTimeoutMs': IDLE_TIMEOUT_MS}
                        for name, settings in SERVICES.items()},
        'maxConnectionsBudget': 151,
    }
    write_private(backup / 'release.json', release_info)

    for name in inputs:
        if sha(Path(name).read_bytes()) != input_hashes[name]:
            raise RuntimeError('Compose inputs changed during the pool rollout')
    if support_ids() != support:
        raise RuntimeError('An unrelated service changed during the pool rollout')
    for container, before in active.items():
        if inspect(container)['Id'] != before['Id']:
            raise RuntimeError('A database client changed before the pool restart')

    try:
        compose_up(meta, env, overlay)
        current = wait_app()
        current_workers = wait_workers()
        if current['Config']['Image'] != EXPECTED_IMAGE:
            raise RuntimeError('App image changed during the pool restart')
        for service, info in zip(SERVICE_NAMES[1:], current_workers):
            if info['Config']['Image'] != worker_infos[service]['Config']['Image']:
                raise RuntimeError('Worker image changed during the pool restart')
        for container, before_id in initial_ids.items():
            if inspect(container)['Id'] == before_id:
                raise RuntimeError('A configured database client was not restarted')
        for name, data in contents.items():
            if container_hash(APP, name) != sha(data):
                raise RuntimeError('App pool fix file hash mismatch')
            run('docker', 'exec', APP, 'node', '--check', '/app/' + name, timeout=60)
        for service, settings in SERVICES.items():
            info = inspect(settings['container'])
            env_values = dict(item.split('=', 1) for item in info['Config'].get('Env', []) if '=' in item)
            if (env_values.get('DB_POOL_LIMIT') != settings['connectionLimit']
                    or env_values.get('DB_POOL_MAX_IDLE') != settings['maxIdle']
                    or env_values.get('DB_POOL_IDLE_TIMEOUT_MS') != IDLE_TIMEOUT_MS):
                raise RuntimeError('Database pool budget did not reach a client')
            if container_hash(settings['container'], 'database/config.js') != sha(contents['database/config.js']):
                raise RuntimeError('Database pool config hash mismatch')
        pool_source = str(release / 'runtime/database/config.js')
        for service in SERVICES:
            info = inspect(SERVICES[service]['container'])
            if not any(mount.get('Source') == pool_source and mount.get('Destination') == '/app/database/config.js'
                       and mount.get('RW') is False for mount in info.get('Mounts', [])):
                raise RuntimeError('Database pool config is not mounted read-only')
        if support_ids() != support:
            raise RuntimeError('Pool rollout changed an unrelated service')
        routes = check_public_routes()
    except Exception as error:
        write_private(backup / 'deployment-failure.txt', f'{type(error).__name__}\n')
        try:
            compose_up(meta, env, None)
            restored = wait_app()
            wait_workers()
            for name, expected in PREIMAGES.items():
                if container_hash(APP, name) != expected:
                    raise RuntimeError('Automatic app rollback file hash mismatch')
            if support_ids() != support or restored['Config']['Image'] != EXPECTED_IMAGE:
                raise RuntimeError('Automatic rollback did not restore the baseline')
            write_private(backup / 'automatic-rollback.json', {
                'appHealth': restored['State'].get('Health', {}).get('Status'),
                'supportServicesUnchanged': True,
            })
        except Exception as rollback_error:
            write_private(backup / 'automatic-rollback-failure.txt', f'{type(rollback_error).__name__}\n')
        raise

    db_after = wait_database_health()
    connections_after = tcp_connection_counts()
    result = {
        **release_info, 'appHealth': current['State'].get('Health', {}).get('Status'),
        'databaseHealth': db_after['State'].get('Health', {}).get('Status'),
        'poolFixActive': True, 'poolRestarted': True,
        'servicesRecreated': list(AFFECTED_CONTAINERS), 'routes': routes,
        'tcpConnectionsAfter': connections_after, 'supportServicesUnchanged': True,
        'databaseHealthRecovered': db_after['State'].get('Health', {}).get('Status') == 'healthy',
    }
    write_private(backup / 'result.json', result)
    print(json.dumps(result))
    return result


def restore(backup):
    require_lock()
    release_info = json.loads((backup / 'release.json').read_text())
    app = inspect(APP)
    meta = service_compose(app, 'app')
    if meta['files'][-1] != release_info['overlay']:
        raise RuntimeError('A later app overlay is active; restore it first')
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('Unrelated services changed since pool deployment')
    original_meta = json.loads((backup / 'compose-meta.json').read_text())
    variables = json.loads((backup / 'compose-vars.json').read_text())
    env = dict(os.environ)
    referenced = {key for name in original_meta['files']
                  for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    for key in referenced:
        env.pop(key, None)
    env.update(variables)
    compose_up(original_meta, env, None)
    restored = wait_app()
    wait_workers()
    for name, expected in PREIMAGES.items():
        if container_hash(APP, name) != expected:
            raise RuntimeError('Rollback file hash mismatch')
    if restored['Config']['Image'] != EXPECTED_IMAGE or support_ids() != support:
        raise RuntimeError('Rollback did not restore the recorded baseline')
    result = {
        'restoredBase': BASE, 'appHealth': restored['State'].get('Health', {}).get('Status'),
        'databaseHealth': inspect(DB)['State'].get('Health', {}).get('Status'),
        'supportServicesUnchanged': True,
    }
    write_private(backup / 'rollback-result.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
            deploy(Path(sys.argv[2]), sys.argv[3])
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(Path(sys.argv[2]))
        else:
            raise RuntimeError('Usage: deploy <stage> <commit> | restore <rollback-directory>')
    except Exception as error:
        frame = error.__traceback__
        while frame and frame.tb_next:
            frame = frame.tb_next
        location = f'{frame.tb_frame.f_code.co_name}:{frame.tb_lineno}' if frame else 'unknown'
        message = str(error)
        detail = (message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message)
                  else 'DATABASE_POOL_RELEASE_FAILED')
        print(f'{detail} [{type(error).__name__} at {location}]', file=sys.stderr)
        sys.exit(1)
