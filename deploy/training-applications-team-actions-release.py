#!/usr/bin/env python3
"""Guarded app-only release for recoverable application and team actions."""
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
SUPPORT = ('salemax-db-1', WORKER, 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
EXPECTED_IMAGE = 'salemax-app:openai-ads-lead-01fde9e1-20261103'
EXPECTED_HEAD = ('/opt/salemax/releases/pipeline-board-stage-counts-8c14780bd7df-20261111/'
                 'compose.pipeline-board-stage-counts.json')
MIGRATION = 'database/migrations/20270204_training_form_submission_archive.sql'
FILES = (
    'client/public/index.html',
    'client/public/team-access.css',
    'client/public/team-invitations.js',
    'client/public/training-forms.css',
    'client/public/training-forms.js',
    'modules/platform/team-invitations.js',
    'modules/platform/team-invitation-router.js',
    'modules/platform/training-forms.js',
    'modules/platform/training-form-router.js',
)
TARGETS = (*FILES, MIGRATION)
PREIMAGES = {
    'client/public/index.html': '537b456cc92fcecc07aa13efad2cee606979d603ac55e749d6965f74f099a145',
    'client/public/team-access.css': 'ecda7b2c1d97f9f3b9e0d7adab23eb2af0c3cc312b018ad786dded77c889413d',
    'client/public/team-invitations.js': '8330ed68e13ba8c3ef63bd9ff7caccacdcaf44d730d3752562256d516cab0d21',
    'client/public/training-forms.css': '4dc7f80158c968ebb60625bf9d5fd09c1bc85947ca773db342ac04ebd809d8e7',
    'client/public/training-forms.js': '18059e70ce1877c05c1db9d02207ab46daf43957c84581544232f2855a7c6303',
    'modules/platform/team-invitations.js': 'c12f0301bcfa3aa8c435928471ce51ea46611784652fac483d4c2e2de8bb0535',
    'modules/platform/team-invitation-router.js': '44fb8f724e7b7c8a52fbf196e91d40602a4d8072929e78a4fda7bab234671784',
    'modules/platform/training-forms.js': '7a0fa48c7bb70a23d48b83e3fc98f5825281ce583925016db150cb9a44cb8da3',
    'modules/platform/training-form-router.js': 'e03d012aa8b599917ceb0d8bcc751bb35f40aba0b8f90fda6ecce02ee400e305',
}
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'


def run(*args, env=None, input_text=None):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode})')
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


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


def compose_up(meta, env, overlays):
    args = compose_args(meta)
    for overlay in overlays:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env)


def wait_app():
    for _ in range(45):
        info = inspect(APP)
        if info['State'].get('Health', {}).get('Status') == 'healthy':
            return info
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def verify_overlay(meta, env, overlays, service, mounts):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after_args = common[:]
    for overlay in overlays:
        after_args += ['-f', str(overlay)]
    after = json.loads(run(*(after_args + ['config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Candidate Compose changes the service set')
    old = copy.deepcopy(before['services'][service])
    new = copy.deepcopy(after['services'][service])
    original = {row['target']: row for row in old.get('volumes', [])}
    expected = dict(original)
    expected.update({row['target']: row for row in mounts})
    actual = {row['target']: row for row in new.get('volumes', [])}
    if set(actual) != set(expected):
        raise RuntimeError('Candidate Compose has unexpected mount targets')
    for target, row in actual.items():
        want = expected[target]
        if (row['type'], row.get('source'), row.get('read_only')) != (want['type'], want.get('source'), want.get('read_only')):
            raise RuntimeError('Candidate Compose has an unexpected mount')
    old.pop('volumes', None)
    new.pop('volumes', None)
    if old != new:
        raise RuntimeError('Candidate Compose changes app configuration beyond reviewed mounts')


def migration_state():
    source = "(async()=>{const p=require('/app/database/config.js').promise();try{const [c]=await p.query(\"SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sx_training_form_submissions' AND column_name IN ('archived_at','archived_by_identity_id')\");const [m]=await p.query(\"SELECT migration_name,status,checksum,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name='20270204_training_form_submission_archive.sql'\");const [r]=await p.query('SELECT COUNT(*) n FROM sx_training_form_submissions');console.log(JSON.stringify({columns:Number(c[0].n),migration:m[0]||null,submissions:Number(r[0].n)}));}finally{await p.end()}})().catch(e=>{console.log(e.code||'DATABASE_PROBE_FAILED');process.exitCode=1})"
    return json.loads(run('docker', 'exec', APP, 'node', '-e', source))


def write_private(path, value):
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    manifest_path = stage / 'manifest.json'
    if not manifest_path.is_file():
        raise RuntimeError('Staging manifest is missing')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or manifest.get('files') != list(TARGETS):
        raise RuntimeError('Staging manifest does not match the requested source commit')
    contents = {}
    for name in TARGETS:
        path = stage / name
        if not path.is_file() or path.is_symlink():
            raise RuntimeError('Staging directory is missing a reviewed source file')
        contents[name] = path.read_bytes()
        if manifest.get('sha256', {}).get(name) != sha(contents[name]):
            raise RuntimeError('Staging file hash differs from its manifest')
    if sha(contents[MIGRATION]) != sha(Path(stage / MIGRATION).read_bytes()):
        raise RuntimeError('Migration checksum mismatch')

    app, worker, db = inspect(APP), inspect(WORKER), inspect('salemax-db-1')
    meta = service_compose(app, 'app')
    if app['Config']['Image'] != EXPECTED_IMAGE or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if worker['State'].get('Status') != 'running' or db['State'].get('Status') != 'running':
        raise RuntimeError('Database or report worker is not running')
    if meta['files'][-1] != EXPECTED_HEAD:
        raise RuntimeError('A newer app overlay is active')
    for name, expected in PREIMAGES.items():
        live = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if live != expected:
            raise RuntimeError('Active application file differs from the reviewed preimage')
    before_schema = migration_state()
    if before_schema['columns'] or before_schema['migration'] is not None:
        raise RuntimeError('Application archive migration is already partially present')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')

    date = time.strftime('%Y%m%d', time.gmtime())
    release = ROOT / 'releases' / f'training-applications-team-actions-{commit[:12]}-{date}'
    backup = ROOT / 'shared' / f'rollback-training-applications-team-actions-{commit[:12]}-{date}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    env, variables = compose_environment(app, meta)
    support = support_ids()
    inputs = sorted(set(meta['files'] + meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    for name, expected in PREIMAGES.items():
        saved = preimages / name
        saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        run('docker', 'cp', f'{APP}:/app/{name}', str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Rollback preimage hash mismatch')
    snapshots = {
        'app-before.json': {'id': app['Id'], 'image': app['Config']['Image'], 'compose': meta},
        'compose-input-hashes.json': input_hashes,
        'compose-vars.json': variables,
        'support-services.json': support,
        'preimage-hashes.json': PREIMAGES,
        'migration-before.json': before_schema,
        'release-path.txt': str(release) + '\n',
        'base-release.txt': BASE + '\n',
        'source-commit.txt': commit + '\n',
    }
    for filename, value in snapshots.items():
        write_private(backup / filename, value)

    mounts = []
    for name in FILES:
        runtime = release / 'runtime' / name
        runtime.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        runtime.write_bytes(contents[name])
        runtime.chmod(0o644)
        mounts.append({'type': 'bind', 'source': str(runtime), 'target': '/app/' + name,
                       'read_only': True, 'bind': {'create_host_path': False}})
    migration_runtime = release / 'runtime' / MIGRATION
    migration_runtime.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    migration_runtime.write_bytes(contents[MIGRATION])
    migration_runtime.chmod(0o644)
    migration_mount = {'type': 'bind', 'source': str(migration_runtime), 'target': '/app/' + MIGRATION,
                       'read_only': True, 'bind': {'create_host_path': False}}
    migration_overlay = release / 'compose.applications-migration.json'
    migration_overlay.write_text(json.dumps({'services': {'app': {'volumes': [migration_mount]}}}))
    migration_overlay.chmod(0o644)
    app_overlay = release / 'compose.applications-team-actions.json'
    app_overlay.write_text(json.dumps({'services': {'app': {'volumes': mounts}}}))
    app_overlay.chmod(0o644)
    verify_overlay(meta, env, [migration_overlay], 'app', [migration_mount])
    verify_overlay(meta, env, [migration_overlay, app_overlay], 'app', [migration_mount, *mounts])
    helper = release / 'deploy' / 'training-applications-team-actions-release.py'
    helper.parent.mkdir(mode=0o755)
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during preparation')
    if inspect(APP)['Id'] != app['Id'] or support_ids() != support:
        raise RuntimeError('A service changed during release preparation')

    migration_started = False
    try:
        compose_up(meta, env, [migration_overlay])
        wait_app()
        migration_started = True
        run('docker', 'exec', APP, 'node', '/app/database/migrate-pipeline.js', '--apply', '--only', Path(MIGRATION).name)
        after_schema = migration_state()
        expected_checksum = sha(contents[MIGRATION])
        if (after_schema['columns'] != 2 or after_schema['migration'] is None
                or after_schema['migration']['status'] != 'applied'
                or after_schema['migration']['checksum'] != expected_checksum
                or after_schema['submissions'] != before_schema['submissions']):
            raise RuntimeError('Application archive migration verification failed')
        compose_up(meta, env, [migration_overlay, app_overlay])
        current = wait_app()
        for name, data in contents.items():
            if name == MIGRATION:
                target = '/app/' + name
            else:
                target = '/app/' + name
            if run('docker', 'exec', APP, 'sha256sum', target).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch')
        for name in ('modules/platform/team-invitations.js', 'modules/platform/team-invitation-router.js',
                     'modules/platform/training-forms.js', 'modules/platform/training-form-router.js',
                     'client/public/team-invitations.js', 'client/public/training-forms.js'):
            run('docker', 'exec', APP, 'node', '--check', '/app/' + name)
        if support_ids() != support or current['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('An unrelated service or app image changed')
        active_files = current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
        if active_files[-2:] != [str(migration_overlay), str(app_overlay)]:
            raise RuntimeError('Application/team overlay chain is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        app_route = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/user?page=dashboard').strip()
        forms_api = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/api/user/training/forms/submissions').strip()
        team_api = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/api/user/team-invitations').strip()
        if app_route != '200' or forms_api not in ('401', '302') or team_api not in ('401', '302'):
            raise RuntimeError('Public route or authenticated API boundary verification failed')
        served = {}
        urls = {
            'client/public/index.html': 'https://7network.live/',
            'client/public/team-access.css': 'https://7network.live/team-access.css?v=20261111-team-member-actions1',
            'client/public/team-invitations.js': 'https://7network.live/team-invitations.js?v=20261111-team-member-actions1',
            'client/public/training-forms.css': 'https://7network.live/training-forms.css?v=20261111-application-archive1',
            'client/public/training-forms.js': 'https://7network.live/training-forms.js?v=20261111-application-archive1',
        }
        for name, url in urls.items():
            body = run('curl', '-fsS', url).encode()
            served[name] = sha(body)
            if served[name] != sha(contents[name]):
                raise RuntimeError('Served application asset hash mismatch')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appHealth': current['State'].get('Health', {}).get('Status'), 'appImage': current['Config']['Image'],
                  'runtimeFiles': {name: sha(data) for name, data in contents.items()}, 'servedFiles': served,
                  'migration': after_schema['migration'], 'schemaColumns': after_schema['columns'],
                  'submissionCountUnchanged': after_schema['submissions'] == before_schema['submissions'],
                  'appRoute': app_route, 'anonymousFormsApi': forms_api, 'anonymousTeamApi': team_api,
                  'supportServicesUnchanged': True, 'healthz': '200', 'appOverlay': str(app_overlay),
                  'migrationOverlay': str(migration_overlay)}
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception as error:
        try:
            write_private(backup / 'deployment-failure.txt', f'{type(error).__name__}: {error}\n')
            compose_up(meta, env, [migration_overlay] if migration_started else [])
            wait_app()
        except Exception:
            pass
        raise


def restore(backup):
    require_lock()
    backup = Path(backup)
    if (backup / 'base-release.txt').read_text().strip() != BASE:
        raise RuntimeError('Rollback base release differs')
    before = json.loads((backup / 'app-before.json').read_text())
    release = Path((backup / 'release-path.txt').read_text().strip())
    migration_overlay = release / 'compose.applications-migration.json'
    app_overlay = release / 'compose.applications-team-actions.json'
    active_files = inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    if active_files[-1] != str(app_overlay):
        raise RuntimeError('A later app overlay is active; roll it back first')
    inputs = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in inputs.items()):
        raise RuntimeError('Rollback Compose inputs changed')
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('A support service changed; refusing rollback')
    schema = migration_state()
    if schema['columns'] != 2 or schema['migration'] is None or schema['migration']['status'] != 'applied':
        raise RuntimeError('Applied migration must remain intact during code rollback')
    if schema['migration']['checksum'] != sha((release / 'runtime' / MIGRATION).read_bytes()):
        raise RuntimeError('Migration source checksum differs during code rollback')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    compose_up(before['compose'], dict(os.environ, **variables), [migration_overlay])
    restored = wait_app()
    if restored['Config']['Image'] != before['image']:
        raise RuntimeError('Rollback image mismatch')
    for name, expected in PREIMAGES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch')
    if support_ids() != support:
        raise RuntimeError('Rollback changed an unrelated service')
    print(json.dumps({'rolledBack': str(release), 'migrationRetained': True,
                      'appHealth': 'healthy', 'supportServicesUnchanged': True}))


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
            deploy(Path(sys.argv[2]), sys.argv[3])
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(sys.argv[2])
        else:
            raise RuntimeError('Usage: deploy <stage> <commit> | restore <rollback-directory>')
    except Exception as error:
        message = str(error)
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'TRAINING_APPLICATIONS_TEAM_ACTIONS_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
