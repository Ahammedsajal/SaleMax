#!/usr/bin/env python3
"""Guarded app-only release for the legacy Training Center Pipeline context fix."""
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
EXPECTED_HEAD = '/opt/salemax/releases/pipeline-followup-filter-brand-6f4a2795d43b-20261111/compose.pipeline-followup-filter-brand.json'
FILES = ('routes/pipeline.js',)
PREVIOUS_MOUNTS = {
    '/app/routes/pipeline.js': '/opt/salemax/releases/pipeline-follow-up-assignment-4eb0f60d4bd7-20261111/runtime/routes/pipeline.js',
}
PREIMAGES = {
    'routes/pipeline.js': '5a7d6e4039aa64e980583c69497ad1dae483e456c11dd6e319caa52727914f09',
}
MANUAL_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
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


def compose_up(meta, env, overlay=None):
    args = compose_args(meta)
    if overlay:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env)


def wait_app():
    for _ in range(45):
        info = inspect(APP)
        if info['State'].get('Health', {}).get('Status') == 'healthy':
            return info
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def verify_overlay(meta, env, overlay, mounts):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(common + ['-f', str(overlay), 'config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Candidate Compose changes the service set')
    old = copy.deepcopy(before['services']['app'])
    new = copy.deepcopy(after['services']['app'])
    old_mounts = {row['target']: row for row in old.get('volumes', [])}
    expected = dict(old_mounts)
    for mount in mounts:
        if mount['target'] in old_mounts:
            previous = old_mounts[mount['target']]
            previous_source = PREVIOUS_MOUNTS.get(mount['target'])
            expected_hash = PREIMAGES.get(mount['target'].removeprefix('/app/'))
            if (previous.get('type') != 'bind' or previous.get('source') != previous_source
                    or previous.get('read_only') is not True or not previous_source or not expected_hash
                    or not Path(previous_source).is_file() or sha(Path(previous_source).read_bytes()) != expected_hash):
                raise RuntimeError('Candidate Compose would replace an unreviewed app mount')
    expected.update({mount['target']: mount for mount in mounts})
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
    route = stage / FILES[0]
    if not route.is_file() or route.is_symlink():
        raise RuntimeError('Staging directory is missing the reviewed Pipeline route')
    contents = {FILES[0]: route.read_bytes()}
    if manifest.get('sha256', {}).get(FILES[0]) != sha(contents[FILES[0]]):
        raise RuntimeError('Staging route hash differs from its manifest')

    app = inspect(APP)
    worker = inspect(WORKER)
    db = inspect('salemax-db-1')
    meta = service_compose(app, 'app')
    if app['Config']['Image'] != EXPECTED_IMAGE or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if worker['State'].get('Status') != 'running' or db['State'].get('Status') != 'running':
        raise RuntimeError('Database or report-worker is not running')
    if meta['files'][-1] != EXPECTED_HEAD:
        raise RuntimeError('A newer app overlay is active')
    for name, expected in PREIMAGES.items():
        live = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if live != expected:
            raise RuntimeError('Active Pipeline route differs from the reviewed preimage')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')

    os.umask(0o077)
    release = ROOT / 'releases' / f'pipeline-workspace-context-{commit[:12]}-20261111'
    backup = ROOT / 'shared' / f'rollback-pipeline-workspace-context-{commit[:12]}-20261111'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    env, variables = compose_environment(app, meta)
    support = support_ids()
    inputs = sorted(set(meta['files'] + meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    preimage = backup / 'preimages' / FILES[0]
    preimage.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    run('docker', 'cp', f'{APP}:/app/{FILES[0]}', str(preimage))
    if sha(preimage.read_bytes()) != PREIMAGES[FILES[0]]:
        raise RuntimeError('Rollback route preimage hash mismatch')
    snapshots = {
        'app-before.json': {'id': app['Id'], 'image': app['Config']['Image'], 'compose': meta},
        'compose-input-hashes.json': input_hashes,
        'compose-vars.json': variables,
        'support-services.json': support,
        'preimage-hashes.json': PREIMAGES,
        'release-path.txt': str(release) + '\n',
        'base-release.txt': BASE + '\n',
        'source-commit.txt': commit + '\n',
    }
    for filename, value in snapshots.items():
        target = backup / filename
        target.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
        target.chmod(0o600)

    runtime = release / 'runtime' / FILES[0]
    runtime.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    runtime.write_bytes(contents[FILES[0]])
    runtime.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime), 'target': '/app/' + FILES[0],
               'read_only': True, 'bind': {'create_host_path': False}}]
    overlay = release / 'compose.pipeline-workspace-context.json'
    overlay.write_text(json.dumps({'services': {'app': {'volumes': mounts}}}))
    overlay.chmod(0o644)
    verify_overlay(meta, env, overlay, mounts)
    helper = release / 'deploy' / 'pipeline-workspace-context-release.py'
    helper.parent.mkdir(mode=0o755)
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during preparation')
    if inspect(APP)['Id'] != app['Id'] or support_ids() != support:
        raise RuntimeError('A service changed during release preparation')

    try:
        compose_up(meta, env, overlay)
        current = wait_app()
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + FILES[0]).split()[0] != sha(contents[FILES[0]]):
            raise RuntimeError('Runtime Pipeline route hash mismatch')
        run('docker', 'exec', APP, 'node', '--check', '/app/' + FILES[0])
        run('docker', 'exec', APP, 'node', '-e', "require('/app/routes/pipeline.js')")
        if support_ids() != support or current['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('An unrelated service or image changed')
        if current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlay):
            raise RuntimeError('Pipeline context overlay is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        route_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/user?page=lead-reports').strip()
        settings_api = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/api/workspace/pipeline/reports/follow-up-assignment').strip()
        if route_status != '200' or settings_api != '401':
            raise RuntimeError('Public route or anonymous API authorization verification failed')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appHealth': current['State'].get('Health', {}).get('Status'), 'appImage': current['Config']['Image'],
                  'routeSha256': sha(contents[FILES[0]]), 'runtimeRouteSha256': sha(contents[FILES[0]]),
                  'appOverlay': str(overlay), 'supportServicesUnchanged': True, 'healthz': '200',
                  'leadReportsRoute': route_status, 'anonymousSettingsApi': settings_api, 'migration': 'none'}
        result_path = backup / 'result.json'
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        result_path.chmod(0o600)
        print(json.dumps(result))
    except Exception as error:
        try:
            (backup / 'deployment-failure.txt').write_text(f'{type(error).__name__}: {error}\n')
        except Exception:
            pass
        compose_up(meta, env)
        wait_app()
        raise


def restore(backup):
    require_lock()
    backup = Path(backup)
    if (backup / 'base-release.txt').read_text().strip() != BASE:
        raise RuntimeError('Rollback base release differs')
    before = json.loads((backup / 'app-before.json').read_text())
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.pipeline-workspace-context.json'
    files = inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    if not files or files[-1] != str(overlay):
        raise RuntimeError('A later app overlay is active; roll it back first')
    inputs = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in inputs.items()):
        raise RuntimeError('Rollback Compose inputs changed')
    support = json.loads((backup / 'support-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('A support service changed; refusing rollback')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    compose_up(before['compose'], dict(os.environ, **variables))
    restored = wait_app()
    if restored['Config']['Image'] != before['image']:
        raise RuntimeError('Rollback image mismatch')
    for name, expected in PREIMAGES.items():
        live = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if live != expected:
            raise RuntimeError('Rollback route hash mismatch')
    if support_ids() != support:
        raise RuntimeError('Rollback changed an unrelated service')
    print(json.dumps({'rolledBack': str(release), 'appHealth': 'healthy', 'supportServicesUnchanged': True}))


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
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'PIPELINE_WORKSPACE_CONTEXT_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
