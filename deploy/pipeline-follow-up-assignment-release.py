#!/usr/bin/env python3
"""Guarded app and report-worker release for daily lead follow-up assignment."""
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
EXPECTED_APP_OVERLAY = '/opt/salemax/releases/pipeline-follow-up-brief-8bd161b98f77-20261110/compose.pipeline-follow-up-brief.json'
EXPECTED_WORKER_OVERLAY = '/opt/salemax/releases/training-owner-report-weekly-date-312064de5ab7-20261110/compose.training-owner-report-worker.json'
APP = 'salemax-app-1'
WORKER = 'salemax-report-worker-1'
SUPPORT = ('salemax-db-1', 'salemax-libretranslate-1', 'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
EXPECTED_IMAGES = {APP: 'salemax-app:openai-ads-lead-01fde9e1-20261103', WORKER: 'salemax-app:business-summary-55b5f11-20261024'}
APP_PREIMAGES = {
    'routes/pipeline.js': 'caf69cd1e1bb2db223ad3b2240b8208efcdbe77b20689b558414b823283acb2d',
    'client/public/pipeline/index.html': 'a758f76657e61c040e910350c3e5caa716dad84220d24aefb25425cb3c957222',
    'client/public/pipeline/reports.js': '3385988a26c690767324040b1b6a3052f6d1d5ee6705fba3edf530ba90fc5384',
    'client/public/pipeline/pipeline.css': '433466c6f67f3acbb4f855eaead92fff7f6c120e492f17bd5c43acffa084ebd9',
    'client/public/pipeline/pipeline-theme.css': '5105d1b9d04f0d69fe41a08cd01f9069bd3a9c2ba2f8b1862cf6d005874db492',
}
WORKER_PREIMAGES = {
    'scripts/training-report-worker.cjs': '0124c5f045b8f69d1de26243f03715ab932c23cb2024efb802247c3cc785e810',
    'helper/pipeline/lead-filters.js': '3ea7fa19f90a19baebffc1ea1564667ca277ed1b46971e4b6ae309a96ddb8f49',
    'helper/pipeline/leadPipeline.js': '77f8eb6b23d2289e9642de2cb4c84e3f3d2d7b122fe253c1c4434a912bf30b2c',
    'modules/platform/categories.js': '90f15bf42a5f28e380aefdd5fb6328284c3fd1642a89a1114872dc06696bdfbb',
    'modules/platform/category-registry.js': '0fe9de358e0abb59d7fe7253054f4c91ad0eb04e2a9899ef42b7b53e97461ae3',
    'modules/platform/policy.js': '51bd131242582fafd38942847e4e188afd5e19a350e07acadcc1a91877bd63fb',
    'modules/platform/navigation.js': '4c38687dd01abfae08be07f40737c0b89249504c4137608fbbf408ae886c2a02',
    'modules/platform/training-lead-journey.js': 'fb1092a334a4492591d9952453ed430fbaf36c5e4fcac54dcd81d4b2066251a4',
}
APP_NEW_FILES = ('modules/platform/pipeline-follow-up-assignment.js', 'database/migrations/20270202_pipeline_followup_assignment.sql')
WORKER_NEW_FILES = ('modules/platform/pipeline-follow-up-assignment.js', 'modules/platform/pipeline-follow-up-brief.js')
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
    release = ROOT / 'releases' / f'pipeline-follow-up-assignment-{commit[:12]}-20261111'
    backup = ROOT / 'shared' / f'rollback-pipeline-follow-up-assignment-{commit[:12]}-20261111'
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
    app_overlay, worker_overlay = release / 'compose.pipeline-follow-up-assignment-app.json', release / 'compose.pipeline-follow-up-assignment-worker.json'
    write_overlay(app_overlay, 'app', mount_rows(release, APP_FILES))
    write_overlay(worker_overlay, 'report-worker', mount_rows(release, WORKER_FILES))
    validate_overlay(app_meta, app_env, app_overlay, 'app', mount_rows(release, APP_FILES))
    validate_overlay(worker_meta, worker_env, worker_overlay, 'report-worker', mount_rows(release, WORKER_FILES))
    own_helper = release / 'deploy/pipeline-follow-up-assignment-release.py'
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
        migration_code = "const runner=require('/app/database/migration-runner');const pool=require('/app/database/config');(async()=>{const db=await pool.promise().getConnection();try{const migrations=runner.discover('/app/database/migrations');const result=await runner.applyMigrations(db,migrations,{only:'20270202_pipeline_followup_assignment.sql'});console.log(JSON.stringify(result));}finally{db.release();await pool.promise().end();}})().catch(e=>{console.error(e.code||'MIGRATION_FAILED');process.exit(1)});"
        migration_result = json.loads(run('docker', 'exec', APP, 'node', '-e', migration_code))
        if migration_result.get('applied') != ['20270202_pipeline_followup_assignment.sql'] and migration_result.get('skipped') != ['20270202_pipeline_followup_assignment.sql']:
            raise RuntimeError('Follow-up assignment migration was not applied or verified')
        compose_up(worker_meta, worker_env, worker_overlay, 'report-worker')
        current_worker = wait_worker()
        verify_files(APP, {name: sha(contents[name]) for name in APP_FILES})
        verify_files(WORKER, {name: sha(contents[name]) for name in WORKER_FILES})
        app_check = "require('/app/modules/platform/pipeline-follow-up-assignment.js');require('/app/routes/pipeline.js');process.stdout.write('app follow-up modules loaded\\n')"
        worker_check = "require('/app/modules/platform/pipeline-follow-up-assignment.js');require('/app/modules/platform/pipeline-follow-up-brief.js');require('/app/helper/pipeline/leadPipeline.js');process.stdout.write('worker follow-up modules loaded\\n')"
        run('docker', 'exec', APP, 'node', '-e', app_check)
        run('docker', 'exec', WORKER, 'node', '-e', worker_check)
        if support_ids() != support:
            raise RuntimeError('A support service identity changed')
        if current_app['Config']['Image'] != app['Config']['Image'] or current_worker['Config']['Image'] != worker['Config']['Image']:
            raise RuntimeError('A service image changed')
        if current_app['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(app_overlay):
            raise RuntimeError('App overlay is not active')
        if current_worker['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(worker_overlay):
            raise RuntimeError('Report-worker overlay is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        anonymous_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://crm.salemax.qa/api/workspace/pipeline/reports/follow-up-assignment').strip()
        if anonymous_status != '401':
            raise RuntimeError('Follow-up assignment API did not enforce authentication')
        migration_status = run('docker', 'exec', APP, 'node', '-e', "const pool=require('/app/database/config');pool.promise().query('SELECT status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',['20270202_pipeline_followup_assignment.sql']).then(([r])=>{console.log(JSON.stringify(r[0]||{}));return pool.promise().end()}).catch(()=>process.exit(1))")
        migration_row = json.loads(migration_status)
        if migration_row.get('status') != 'applied' or int(migration_row.get('statement_count') or 0) != 4 or int(migration_row.get('statements_completed') or 0) != 4:
            raise RuntimeError('Follow-up assignment migration ledger verification failed')
        app_chain = current_app['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
        public_files = {}
        for name, url in {
            'client/public/pipeline/index.html': 'https://crm.salemax.qa/pipeline/index.html',
            'client/public/pipeline/reports.js': 'https://crm.salemax.qa/pipeline/reports.js?v=20261111-follow-up-assignment1',
            'client/public/pipeline/pipeline.css': 'https://crm.salemax.qa/pipeline/pipeline.css?v=20261111-follow-up-assignment1',
            'client/public/pipeline/pipeline-theme.css': 'https://crm.salemax.qa/pipeline/pipeline-theme.css?v=20261111-follow-up-assignment1',
        }.items():
            served = run('curl', '-fsS', url).encode()
            expected = sha(contents[name])
            if sha(served) != expected:
                raise RuntimeError('Served Pipeline asset hash mismatch: ' + name)
            public_files[name] = expected
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appImage': current_app['Config']['Image'], 'workerImage': current_worker['Config']['Image'],
                  'appHealth': current_app['State'].get('Health', {}).get('Status'), 'workerState': current_worker['State'].get('Status'),
                  'appFiles': {name: sha(contents[name]) for name in APP_FILES},
                  'workerFiles': {name: sha(contents[name]) for name in WORKER_FILES},
                  'appComposeInputs': len(app_chain), 'workerComposeInputs': len(current_worker['Config']['Labels']['com.docker.compose.project.config_files'].split(',')),
                  'supportServicesUnchanged': True, 'migration': migration_result, 'migrationLedger': migration_row,
                  'anonymousAssignmentApi': anonymous_status, 'publicFiles': public_files, 'healthz': '200'}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception as error:
        try:
            (backup / 'deployment-failure.txt').write_text(f'{type(error).__name__}: {error}\n')
        except Exception:
            pass
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
    overlays = (release / 'compose.pipeline-follow-up-assignment-app.json', release / 'compose.pipeline-follow-up-assignment-worker.json')
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
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'PIPELINE_FOLLOW_UP_ASSIGNMENT_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
