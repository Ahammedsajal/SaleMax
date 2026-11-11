#!/usr/bin/env python3
"""Deploy owner-configurable follow-up selection over the retained migration mount."""
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
EXPECTED_APP_HEAD = '/opt/salemax/releases/pipeline-followup-agent-selection-f9e96691fb3b-20261111/compose.followup-agent-migration.json'
EXPECTED_WORKER_HEAD = '/opt/salemax/releases/pipeline-follow-up-assignment-domain-c9267469ad33-20261111/compose.follow-up-domain-worker.json'
MIGRATION = 'database/migrations/20270203_pipeline_followup_assignment_agents.sql'
APP_FILES = {
    'modules/platform/pipeline-follow-up-assignment.js': '914c77c219604e37847c6954a7ac4d6c03590ef68b22056b32ded49a315a3219',
    'routes/pipeline.js': 'd1591d01cb5b2a163a1bd7110ded90a3a8458aa9cd40391aa365d1834b79c10a',
    'client/public/pipeline/reports.js': 'de48520a8a4e50ac50a3c8b621e6520559a47fd6a618f260474e5208c3ab8afb',
    'client/public/pipeline/index.html': 'a59d87d04ed64b42727b01e05fea58fd269b173f5fe247c4a94860238e25ace1',
    'client/public/pipeline/pipeline.css': '072a5e7f3ccc42ca578a17feb3ffab8f95ba2e502f978ac057cf7eb095005181',
    'client/public/pipeline/pipeline-theme.css': '3c30ec2328c493ba6f0b1ee50b82351ecf480ac75dfbcbd9c79aac232e3669bc',
}
WORKER_FILES = ('modules/platform/pipeline-follow-up-assignment.js',)
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
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
    return dict(os.environ, **variables)


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


def verify_compose_overlay(meta, env, overlay, service, mounts):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(common + ['-f', str(overlay), 'config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Candidate Compose changes the service set')
    before_copy, after_copy = copy.deepcopy(before), copy.deepcopy(after)
    old, new = before_copy['services'][service], after_copy['services'][service]
    expected = {row['target']: row for row in old.get('volumes', [])}
    for mount in mounts:
        expected[mount['target']] = mount
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
        raise RuntimeError('Candidate Compose changes service configuration beyond reviewed mounts')


def runtime_hash(service, target):
    return run('docker', 'exec', service, 'sha256sum', '/app/' + target).split()[0]


def migration_state():
    source = "(async()=>{const pool=require('/app/database/config.js').promise();try{const [c]=await pool.query(\"SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sx_pipeline_followup_assignment_settings' AND column_name='eligible_agent_ids_json'\");const [m]=await pool.query(\"SELECT migration_name,status,checksum FROM salemax_schema_migrations WHERE migration_name='20270203_pipeline_followup_assignment_agents.sql'\");console.log(JSON.stringify({column:Number(c[0].n),migration:m[0]||null}));}finally{await pool.end()}})().catch(e=>{console.log(e.code||'DATABASE_PROBE_FAILED');process.exitCode=1})"
    return json_output(run('docker', 'exec', APP, 'node', '-e', source))


def source_bytes(stage, target):
    path = stage / target
    if not path.is_file() or path.is_symlink():
        raise RuntimeError('Staging directory is missing a reviewed source file')
    return path.read_bytes()


def write_private(path, value):
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    app, worker = inspect(APP), inspect(WORKER)
    app_meta, worker_meta = service_compose(app, 'app'), service_compose(worker, 'report-worker')
    if app['Config']['Image'] != EXPECTED_IMAGES[APP] or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app state differs from the reviewed baseline')
    if worker['Config']['Image'] != EXPECTED_IMAGES[WORKER] or worker['State'].get('Status') != 'running':
        raise RuntimeError('Active report-worker state differs from the reviewed baseline')
    if app_meta['files'][-1] != EXPECTED_APP_HEAD or worker_meta['files'][-1] != EXPECTED_WORKER_HEAD:
        raise RuntimeError('A newer app or report-worker overlay is active')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')
    for target, expected in APP_FILES.items():
        if runtime_hash(APP, target) != expected:
            raise RuntimeError('Active app file differs from the reviewed preimage')
    migration_source = source_bytes(stage, MIGRATION)
    if runtime_hash(APP, MIGRATION) != sha(migration_source):
        raise RuntimeError('Retained migration mount differs from the reviewed migration source')
    migration = migration_state()
    if migration['column'] != 1 or migration['migration'] is None or migration['migration']['status'] != 'applied':
        raise RuntimeError('Additive settings migration is not applied')
    if migration['migration']['checksum'] != sha(migration_source):
        raise RuntimeError('Migration ledger checksum differs from the reviewed source')
    sources = {target: source_bytes(stage, target) for target in APP_FILES}
    release_date = time.strftime('%Y%m%d', time.gmtime())
    release = ROOT / 'releases' / f'pipeline-followup-agent-selection-{commit[:12]}-{release_date}'
    backup = ROOT / 'shared' / f'rollback-pipeline-followup-agent-selection-{commit[:12]}-{release_date}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    app_env, worker_env = compose_environment(app, app_meta), compose_environment(worker, worker_meta)
    states = {APP: {'id': app['Id'], 'image': app['Config']['Image'], 'compose': app_meta},
              WORKER: {'id': worker['Id'], 'image': worker['Config']['Image'], 'compose': worker_meta}}
    inputs = sorted(set(app_meta['files'] + app_meta['env_files'] + worker_meta['files'] + worker_meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    preimage_dir = backup / 'preimages'
    preimage_dir.mkdir(mode=0o700)
    for service, targets in ((APP, tuple(APP_FILES)), (WORKER, WORKER_FILES)):
        for target in targets:
            destination = preimage_dir / service / target
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            run('docker', 'cp', service + ':/app/' + target, str(destination))
            expected = APP_FILES[target] if service == APP else APP_FILES[WORKER_FILES[0]]
            if sha(destination.read_bytes()) != expected:
                raise RuntimeError('Rollback source snapshot hash mismatch')
    snapshots = {
        'services-before.json': states,
        'compose-input-hashes.json': input_hashes,
        'support-services.json': support_ids(),
        'release-path.txt': str(release) + '\n',
        'base-release.txt': BASE + '\n',
        'migration-state.json': migration,
        'source-hashes.json': {**{target: sha(data) for target, data in sources.items()}, MIGRATION: sha(migration_source)},
    }
    for filename, value in snapshots.items():
        write_private(backup / filename, value)
    runtime = release / 'runtime'
    for target, contents in sources.items():
        destination = runtime / target
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        destination.write_bytes(contents)
        destination.chmod(0o644)
    app_overlay = release / 'compose.followup-agent-app.json'
    app_mounts = [{'type': 'bind', 'source': str(runtime / target), 'target': '/app/' + target, 'read_only': True, 'bind': {'create_host_path': False}} for target in APP_FILES]
    app_overlay.write_text(json.dumps({'services': {'app': {'volumes': app_mounts}}}))
    app_overlay.chmod(0o644)
    verify_compose_overlay(app_meta, app_env, app_overlay, 'app', app_mounts)
    worker_overlay = release / 'compose.followup-agent-worker.json'
    worker_mounts = [{'type': 'bind', 'source': str(runtime / target), 'target': '/app/' + target, 'read_only': True, 'bind': {'create_host_path': False}} for target in WORKER_FILES]
    worker_overlay.write_text(json.dumps({'services': {'report-worker': {'volumes': worker_mounts}}}))
    worker_overlay.chmod(0o644)
    verify_compose_overlay(worker_meta, worker_env, worker_overlay, 'report-worker', worker_mounts)
    helper_path = release / 'deploy' / Path(__file__).name
    helper_path.parent.mkdir(mode=0o755)
    helper_path.write_bytes(Path(__file__).read_bytes())
    helper_path.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during preparation')
    if inspect(APP)['Id'] != app['Id'] or inspect(WORKER)['Id'] != worker['Id']:
        raise RuntimeError('A service changed during release preparation')
    support = snapshots['support-services.json']
    try:
        compose_up(app_meta, app_env, app_overlay, 'app')
        current_app = wait_service(APP)
        compose_up(worker_meta, worker_env, worker_overlay, 'report-worker')
        current_worker = wait_service(WORKER)
        for target, contents in sources.items():
            if runtime_hash(APP, target) != sha(contents):
                raise RuntimeError('App runtime file hash mismatch')
        if runtime_hash(WORKER, WORKER_FILES[0]) != sha(sources[WORKER_FILES[0]]):
            raise RuntimeError('Worker follow-up module hash mismatch')
        if runtime_hash(APP, MIGRATION) != sha(migration_source):
            raise RuntimeError('Migration file mount changed during application release')
        run('docker', 'exec', APP, 'node', '-e', "require('/app/modules/platform/pipeline-follow-up-assignment.js');process.exit(0)")
        run('docker', 'exec', WORKER, 'node', '-e', "require('/app/modules/platform/pipeline-follow-up-assignment.js');process.exit(0)")
        if support_ids() != support:
            raise RuntimeError('A support service identity changed')
        if current_app['Config']['Image'] != app['Config']['Image'] or current_worker['Config']['Image'] != worker['Config']['Image']:
            raise RuntimeError('Service image changed')
        if current_app['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(app_overlay):
            raise RuntimeError('App overlay is not active')
        if current_worker['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(worker_overlay):
            raise RuntimeError('Report-worker overlay is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        route_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/user?page=pipeline').strip()
        api_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/api/workspace/pipeline/reports/follow-up-assignment').strip()
        if route_status != '200' or api_status != '401':
            raise RuntimeError('Public route or API authentication verification failed')
        asset_hashes = {}
        for path in ('pipeline/index.html', 'pipeline/reports.js', 'pipeline/pipeline.css', 'pipeline/pipeline-theme.css'):
            url = f'https://7network.live/{path}?v={commit[:12]}'
            result = run('curl', '-fsS', url)
            if sha(result.encode()) != sha(sources['client/public/' + path]):
                raise RuntimeError('Served Pipeline asset differs from reviewed source')
            asset_hashes[path] = sha(result.encode())
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appHealth': current_app['State'].get('Health', {}).get('Status'), 'workerState': current_worker['State'].get('Status'),
                  'appOverlay': str(app_overlay), 'workerOverlay': str(worker_overlay), 'migrationOverlayRetained': app_meta['files'][-1],
                  'runtimeHashes': {**{target: sha(contents) for target, contents in sources.items()}, MIGRATION: sha(migration_source)},
                  'servedAssets': asset_hashes, 'migration': migration, 'supportServicesUnchanged': True,
                  'healthz': '200', 'pipelineRoute': route_status, 'anonymousAssignmentApi': api_status}
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception as error:
        try:
            write_private(backup / 'deployment-failure.txt', f'{type(error).__name__}: {error}\n')
        except Exception:
            pass
        for service, meta, env in ((APP, app_meta, app_env), (WORKER, worker_meta, worker_env)):
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
    app_overlay, worker_overlay = release / 'compose.followup-agent-app.json', release / 'compose.followup-agent-worker.json'
    for service, overlay in ((APP, app_overlay), (WORKER, worker_overlay)):
        files = inspect(service)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
        if not files or files[-1] != str(overlay):
            raise RuntimeError('A later release is active; roll it back first')
    inputs = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in inputs.items()):
        raise RuntimeError('Rollback Compose inputs changed')
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('A support service changed; refusing rollback')
    app_info, worker_info = inspect(APP), inspect(WORKER)
    app_meta, worker_meta = states[APP]['compose'], states[WORKER]['compose']
    app_env, worker_env = compose_environment(app_info, app_meta), compose_environment(worker_info, worker_meta)
    compose_up(app_meta, app_env, None, 'app')
    restored_app = wait_service(APP)
    compose_up(worker_meta, worker_env, None, 'report-worker')
    restored_worker = wait_service(WORKER)
    for service, targets in ((APP, tuple(APP_FILES)), (WORKER, WORKER_FILES)):
        for target in targets:
            expected = APP_FILES[target] if service == APP else APP_FILES[WORKER_FILES[0]]
            if runtime_hash(service, target) != expected:
                raise RuntimeError('Rollback source hash mismatch')
    migration = migration_state()
    if migration['column'] != 1 or migration['migration'] is None or migration['migration']['status'] != 'applied':
        raise RuntimeError('Additive settings migration must remain applied during code rollback')
    expected_migration = json.loads((backup / 'source-hashes.json').read_text())[MIGRATION]
    if runtime_hash(APP, MIGRATION) != expected_migration:
        raise RuntimeError('Retained migration file is missing after code rollback')
    if restored_app['Config']['Image'] != states[APP]['image'] or restored_worker['Config']['Image'] != states[WORKER]['image']:
        raise RuntimeError('Rollback image mismatch')
    if support_ids() != support:
        raise RuntimeError('Rollback changed a support service')
    print(json.dumps({'rolledBack': str(release), 'migrationRetained': True, 'appHealth': 'healthy', 'workerState': 'running', 'supportServicesUnchanged': True}))


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
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'PIPELINE_FOLLOWUP_AGENT_SELECTION_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
