#!/usr/bin/env python3
"""Budget every 7Network DB pool process and release idle bursts."""
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
EXPECTED_APP_IMAGE = 'salemax-app:email-marketing-21a07cc41fa9-20261112'
APP = 'salemax-app-1'
DB = 'salemax-db-1'
SERVICES = {
    'app': {'container': APP, 'limit': '50', 'previousLimit': '100', 'previousMaxIdle': '1'},
    'report-worker': {
        'container': 'salemax-report-worker-1', 'limit': '15',
        'previousLimit': '15', 'previousMaxIdle': '1',
    },
    'recruitment-founder-notification-worker': {
        'container': 'salemax-recruitment-founder-notification-worker-1',
        'limit': '5', 'previousLimit': '5', 'previousMaxIdle': '1',
    },
}
SUPPORT = ('salemax-db-1', 'salemax-libretranslate-1', 'salemax-bot-lead-test-db')
SERVICE_NAMES = tuple(SERVICES)
MAX_IDLE = '1'
IDLE_TIMEOUT_MS = '60000'
MAX_POOL_BUDGET = 120
EXPECTED_PROCESS_COUNTS = {'app': 2, 'report-worker': 1,
                           'recruitment-founder-notification-worker': 1}
EXPECTED_POOL_OVERLAY = '/opt/salemax/releases/database-pool-budget-6b9af8a42ec9-20261112/compose.database-pool-recovery.json'
EXPECTED_EMAIL_OVERLAY = '/opt/salemax/releases/email-marketing-21a07cc41fa9-20261112/compose.email-marketing.json'
EXPECTED_IDLE_OVERLAY = '/opt/salemax/releases/database-pool-idle-one-3be629a537ef-20261112/compose.database-pool-idle-reserve.json'
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'


def run(*args, env=None, timeout=120):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        command = Path(args[0]).name
        raise RuntimeError(f'{command} failed with exit code {result.returncode}')
    return result.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_private(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    data = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    path.write_text(data)
    path.chmod(0o600)


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def state(info):
    env = dict(item.split('=', 1) for item in info.get('Config', {}).get('Env', []) if '=' in item)
    return {
        'id': info['Id'],
        'imageRef': info['Config']['Image'],
        'imageId': info['Image'],
        'status': info['State'].get('Status'),
        'health': (info['State'].get('Health') or {}).get('Status'),
        'restartCount': info.get('RestartCount'),
        'startedAt': info['State'].get('StartedAt'),
        'pool': {key: env.get(key) for key in (
            'DB_POOL_LIMIT', 'DB_POOL_MAX_IDLE', 'DB_POOL_IDLE_TIMEOUT_MS')},
    }


def support_ids():
    return {name: inspect(name)['Id'] for name in SUPPORT}


def node_process_count(container):
    rows = run('docker', 'top', container, '-eo', 'comm').splitlines()[1:]
    return sum(row.strip() == 'node' for row in rows)


def compose_meta(info, service, allow_idle_overlay=None):
    labels = info.get('Config', {}).get('Labels') or {}
    if (labels.get('com.docker.compose.project') != 'salemax'
            or labels.get('com.docker.compose.service') != service):
        raise RuntimeError('Unexpected 7Network Compose service identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if (not workdir or not files or not env_files
            or not all(Path(path).is_file() for path in files + env_files)):
        raise RuntimeError('Active Compose inputs are incomplete')
    if (EXPECTED_POOL_OVERLAY not in files or EXPECTED_EMAIL_OVERLAY not in files
            or (files[-1] != EXPECTED_IDLE_OVERLAY and files[-1] != allow_idle_overlay)):
        raise RuntimeError('A different app release or pool overlay is active')
    return {'files': files, 'env_files': env_files, 'workdir': workdir}


def compose_args(meta):
    args = ['docker', 'compose', '--project-name', 'salemax',
            '--project-directory', meta['workdir']]
    for path in meta['env_files']:
        args += ['--env-file', path]
    for path in meta['files']:
        args += ['-f', path]
    return args


def compose_env(meta, app_info):
    live = dict(item.split('=', 1) for item in app_info['Config'].get('Env', []) if '=' in item)
    referenced = set()
    for path in meta['files']:
        referenced.update(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(path).read_text()))
    supplied = {key for path in meta['env_files']
                for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(path).read_text(), re.M)}
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
    return effective


def config(meta, env, overlay=None):
    args = compose_args(meta)
    if overlay:
        args += ['-f', str(overlay)]
    args += ['config', '--format', 'json']
    return json.loads(run(*args, env=env))


def verify_overlay(meta, env, overlay):
    before = config(meta, env)
    after = config(meta, env, overlay)
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Pool overlay changes the service set')
    for service in before['services']:
        old = dict(before['services'][service])
        new = dict(after['services'][service])
        old_env = dict(old.pop('environment', {}) or {})
        new_env = dict(new.pop('environment', {}) or {})
        if service in SERVICES:
            expected = dict(old_env)
            expected['DB_POOL_LIMIT'] = SERVICES[service]['limit']
            expected['DB_POOL_MAX_IDLE'] = MAX_IDLE
            if new_env != expected:
                raise RuntimeError('Pool overlay changes unreviewed environment values')
            if old != new:
                raise RuntimeError('Pool overlay changes other service configuration')
        elif old_env != new_env or old != new:
            raise RuntimeError('Pool overlay changes an unrelated service')


def wait_app(timeout_seconds=180):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        info = inspect(APP)
        if (info['State'].get('Status') == 'running'
                and info['State'].get('Health', {}).get('Status') == 'healthy'):
            return info
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def wait_workers(expected_images, timeout_seconds=120):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        infos = {name: inspect(settings['container']) for name, settings in SERVICES.items()
                 if name != 'app'}
        ready = all(info['State'].get('Status') == 'running'
                    and info['Image'] == expected_images[name] for name, info in infos.items())
        if ready:
            return infos
        time.sleep(2)
    raise RuntimeError('Database workers did not recover')


def compose_up(meta, env, overlay=None):
    args = compose_args(meta)
    if overlay:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', *SERVICE_NAMES]),
        env=env, timeout=300)


def compose_dry_run(meta, env, overlay):
    args = compose_args(meta) + ['-f', str(overlay), '--dry-run', 'up', '-d',
                                 '--no-deps', '--no-build', '--force-recreate', *SERVICE_NAMES]
    output = run(*args, env=env, timeout=120).lower()
    if re.search(r'\bpull(?:ing)?\b|\bbuild(?:ing)?\b', output):
        raise RuntimeError('Compose dry run would pull or build an image')


def verify_public_routes():
    health = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
                 'https://7network.live/healthz', timeout=30).strip()
    user = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
               'https://7network.live/user?page=campaign-dashboard', timeout=30).strip()
    if health != '200' or user != '200':
        raise RuntimeError('Public health or user route verification failed')
    return {'healthz': health, 'userRoute': user}


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or base release changed')


def manifest_for(stage, commit):
    manifest = json.loads((stage / 'manifest.json').read_text())
    if (manifest.get('sourceCommit') != commit
            or manifest.get('helperSha256') != digest(Path(__file__).read_bytes())):
        raise RuntimeError('Staged idle-release helper does not match its source manifest')


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    manifest_for(stage, commit)
    app = inspect(APP)
    db = inspect(DB)
    if (app['Config']['Image'] != EXPECTED_APP_IMAGE
            or app['State'].get('Status') != 'running'
            or app['State'].get('Health', {}).get('Status') != 'healthy'):
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if db['State'].get('Status') != 'running' or db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('MariaDB is not healthy')

    active = {name: inspect(settings['container']) for name, settings in SERVICES.items()}
    process_counts = {name: node_process_count(settings['container'])
                      for name, settings in SERVICES.items()}
    if process_counts != EXPECTED_PROCESS_COUNTS:
        raise RuntimeError('Database client process count differs from the reviewed pool budget')
    pool_budget = sum(int(SERVICES[name]['limit']) * process_counts[name]
                      for name in SERVICES)
    if pool_budget > MAX_POOL_BUDGET:
        raise RuntimeError('Aggregate database pool budget exceeds 120 connections')
    for name, info in active.items():
        expected_service = name
        labels = info.get('Config', {}).get('Labels') or {}
        if (info['State'].get('Status') != 'running'
                or labels.get('com.docker.compose.service') != expected_service):
            raise RuntimeError('A database client is not the expected running service')
        values = dict(item.split('=', 1) for item in info['Config'].get('Env', []) if '=' in item)
        settings = SERVICES[name]
        if (values.get('DB_POOL_LIMIT') != settings['previousLimit']
                or values.get('DB_POOL_MAX_IDLE') != settings['previousMaxIdle']
                or values.get('DB_POOL_IDLE_TIMEOUT_MS') != IDLE_TIMEOUT_MS):
            raise RuntimeError('Live database pool settings differ from the reviewed baseline')

    meta = compose_meta(app, 'app')
    env = compose_env(meta, app)
    support = support_ids()
    before_states = {name: state(info) for name, info in active.items()}
    input_files = sorted(set(meta['files'] + meta['env_files']))
    input_hashes = {path: digest(Path(path).read_bytes()) for path in input_files}
    date = time.strftime('%Y%m%d', time.gmtime())
    release = ROOT / 'releases' / f'database-pool-process-budget-{commit[:12]}-{date}'
    backup = ROOT / 'shared' / f'rollback-database-pool-process-budget-{commit[:12]}-{date}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')

    os.umask(0o077)
    release.mkdir(mode=0o755)
    release.chmod(0o755)
    backup.mkdir(mode=0o700)
    overlay = release / 'compose.database-pool-process-budget.json'
    overlay_data = {'services': {
        name: {'environment': {
            'DB_POOL_LIMIT': settings['limit'],
            'DB_POOL_MAX_IDLE': MAX_IDLE,
            'DB_POOL_IDLE_TIMEOUT_MS': IDLE_TIMEOUT_MS,
        }} for name, settings in SERVICES.items()
    }}
    overlay.write_text(json.dumps(overlay_data, indent=2) + '\n')
    overlay.chmod(0o644)
    verify_overlay(meta, env, overlay)

    helper_copy = release / 'deploy' / Path(__file__).name
    helper_copy.parent.mkdir(mode=0o755)
    shutil.copyfile(__file__, helper_copy)
    helper_copy.chmod(0o644)
    write_private(backup / 'compose-meta.json', meta)
    write_private(backup / 'compose-input-hashes.json', input_hashes)
    write_private(backup / 'support-services.json', support)
    write_private(backup / 'services-before.json', before_states)
    write_private(backup / 'release.json', {
        'sourceCommit': commit, 'baseRelease': BASE, 'release': str(release),
        'overlay': str(overlay), 'rollback': str(backup), 'maxIdle': MAX_IDLE,
        'processCounts': process_counts, 'maxPoolBudget': pool_budget,
        'idleTimeoutMs': IDLE_TIMEOUT_MS, 'poolLimits': {
            name: settings['limit'] for name, settings in SERVICES.items()},
        'composeInputHashes': input_hashes,
    })

    for path, expected_hash in input_hashes.items():
        if digest(Path(path).read_bytes()) != expected_hash:
            raise RuntimeError('Compose input changed before the pool update')
    if support_ids() != support:
        raise RuntimeError('An unrelated service changed before the pool update')
    for name, before in active.items():
        if inspect(SERVICES[name]['container'])['Id'] != before['Id']:
            raise RuntimeError('A database client changed before the pool update')
    compose_dry_run(meta, env, overlay)

    try:
        compose_up(meta, env, overlay)
        current_app = wait_app()
        current_workers = wait_workers({
            name: before['Image'] for name, before in active.items() if name != 'app'})
        current = {'app': current_app, **current_workers}
        for name, info in current.items():
            after = state(info)
            if info['Id'] == active[name]['Id'] or info['Image'] != active[name]['Image']:
                raise RuntimeError('A pool client was not restarted with its prior image')
            if after['pool'] != {
                'DB_POOL_LIMIT': SERVICES[name]['limit'],
                'DB_POOL_MAX_IDLE': MAX_IDLE,
                'DB_POOL_IDLE_TIMEOUT_MS': IDLE_TIMEOUT_MS,
            }:
                raise RuntimeError('A client did not receive the reviewed pool settings')
        if support_ids() != support or inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Database or an unrelated support service changed')
        if compose_meta(current_app, 'app', str(overlay))['files'][-1] != str(overlay):
            raise RuntimeError('Idle reserve overlay is not the active Compose input')
        routes = verify_public_routes()
    except Exception as error:
        write_private(backup / 'deployment-failure.txt', f'{type(error).__name__}\n')
        try:
            compose_up(meta, env)
            restored_app = wait_app()
            restored_workers = wait_workers({
                name: before['Image'] for name, before in active.items() if name != 'app'})
            restored = {'app': restored_app, **restored_workers}
            for name, info in restored.items():
                if state(info)['pool'] != before_states[name]['pool']:
                    raise RuntimeError('Automatic rollback pool settings mismatch')
            if support_ids() != support:
                raise RuntimeError('Automatic rollback changed an unrelated service')
            write_private(backup / 'automatic-rollback.json', {
                'appHealth': restored_app['State'].get('Health', {}).get('Status'),
                'supportServicesUnchanged': True,
            })
        except Exception as rollback_error:
            write_private(backup / 'automatic-rollback-failure.txt',
                          f'{type(rollback_error).__name__}\n')
        raise

    result = {
        'sourceCommit': commit, 'release': str(release), 'overlay': str(overlay),
        'rollback': str(backup), 'appHealth': current_app['State'].get('Health', {}).get('Status'),
        'databaseHealth': inspect(DB)['State'].get('Health', {}).get('Status'),
        'servicesRecreated': {name: state(info) for name, info in current.items()},
        'processCounts': process_counts, 'maxPoolBudget': pool_budget,
        'supportServicesUnchanged': True, 'routes': routes,
        'databaseMigrations': [],
    }
    write_private(backup / 'result.json', result)
    print(json.dumps(result))
    return result


def restore(backup):
    require_lock()
    release_info = json.loads((backup / 'release.json').read_text())
    app = inspect(APP)
    meta = compose_meta(app, 'app', release_info['overlay'])
    if meta['files'][-1] != release_info['overlay']:
        raise RuntimeError('A later app overlay is active; restore it first')
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('Unrelated services changed since the idle update')
    expected_hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    for path, expected_hash in expected_hashes.items():
        if not Path(path).is_file() or digest(Path(path).read_bytes()) != expected_hash:
            raise RuntimeError('A prior Compose input changed; refusing automatic restore')
    previous_meta = json.loads((backup / 'compose-meta.json').read_text())
    env = compose_env(previous_meta, app)
    compose_up(previous_meta, env)
    restored_app = wait_app()
    previous_states = json.loads((backup / 'services-before.json').read_text())
    restored_workers = wait_workers({
        name: previous_states[name]['imageId'] for name in previous_states if name != 'app'})
    restored = {'app': restored_app, **restored_workers}
    for name, info in restored.items():
        if state(info)['pool'] != previous_states[name]['pool']:
            raise RuntimeError('Rollback did not restore prior pool settings')
    if support_ids() != support:
        raise RuntimeError('Rollback changed an unrelated service')
    result = {
        'restoredPoolLimits': {name: state(info)['pool']['DB_POOL_LIMIT']
                               for name, info in restored.items()},
        'restoredMaxIdle': {name: state(info)['pool']['DB_POOL_MAX_IDLE']
                            for name, info in restored.items()},
        'appHealth': restored_app['State'].get('Health', {}).get('Status'),
        'supportServicesUnchanged': True, 'databaseMigrations': [],
    }
    write_private(backup / 'restore-result.json', result)
    print(json.dumps(result))


def main():
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise RuntimeError('Usage: deploy <stage-directory> <source-commit> | restore <rollback-directory>')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': type(error).__name__, 'message': str(error)}), file=sys.stderr)
        sys.exit(1)
