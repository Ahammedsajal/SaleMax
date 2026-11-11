#!/usr/bin/env python3
"""Guarded app-only overlay for Pipeline Day 2 / Day 7 follow-up reporting."""
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
EXPECTED_HEAD = '/opt/salemax/releases/pro-catalyst-followup-cadence-63519bd0859b-20261111/compose.pro-catalyst-followup-cadence.json'
FILES = (
    'client/public/pipeline/index.html',
    'client/public/pipeline/reports.js',
    'client/public/pipeline/pipeline.css',
    'client/public/pipeline/pipeline-theme.css',
    'modules/platform/chatbot-followup-preview.js',
    'routes/pipeline.js',
)
PREVIOUS_MOUNTS = {
    '/app/client/public/pipeline/index.html': '/opt/salemax/releases/pipeline-board-stage-counts-8c14780bd7df-20261111/runtime/client/public/pipeline/index.html',
    '/app/client/public/pipeline/reports.js': '/opt/salemax/releases/pipeline-followup-agent-selection-6c96419fdb1c-20261111/runtime/client/public/pipeline/reports.js',
    '/app/client/public/pipeline/pipeline.css': '/opt/salemax/releases/pipeline-board-stage-counts-8c14780bd7df-20261111/runtime/client/public/pipeline/pipeline.css',
    '/app/client/public/pipeline/pipeline-theme.css': '/opt/salemax/releases/pipeline-board-stage-counts-8c14780bd7df-20261111/runtime/client/public/pipeline/pipeline-theme.css',
    '/app/modules/platform/chatbot-followup-preview.js': '/opt/salemax/releases/pro-catalyst-followup-delivery-bda7619a1615-20261110/runtime/modules/platform/chatbot-followup-preview.js',
    '/app/routes/pipeline.js': '/opt/salemax/releases/pipeline-followup-agent-selection-6c96419fdb1c-20261111/runtime/routes/pipeline.js',
}
PREIMAGES = {
    'client/public/pipeline/index.html': 'd27aa2b9723625abbfa600751e3b5e208650cd87fc2d68dac628b659b1ba2eba',
    'client/public/pipeline/reports.js': '242f0dcf16d529a607f6f0cd88644d5ccda608041844afd54a082008627ce7b4',
    'client/public/pipeline/pipeline.css': '565b71b56f19dcf6cf8401cbe04a07c636a7803eb2331b2c8e6899ec908e7b2f',
    'client/public/pipeline/pipeline-theme.css': 'a980aad1e66bbf64f128eac3203f816dfff9d69de68a5cfc9732f6deb4de7d48',
    'modules/platform/chatbot-followup-preview.js': 'fad0ea728ee60fc1852a005f42236c1f6c2d3f6fb48a15977992ea1cc00a5a56',
    'routes/pipeline.js': '37623cf998051abaab031705d9d41fed1b43723335d91f816c1d46f89dd245fe',
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
    for item in (old, new):
        item.pop('volumes', None)
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
    contents = {}
    for name in FILES:
        path = stage / name
        if not path.is_file() or path.is_symlink():
            raise RuntimeError('Staging directory is missing a reviewed Pipeline file')
        contents[name] = path.read_bytes()
        if manifest.get('sha256', {}).get(name) != sha(contents[name]):
            raise RuntimeError('Staging file hash differs from its manifest')
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
            raise RuntimeError('Active Pipeline file differs from the reviewed preimage')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')

    os.umask(0o077)
    release = ROOT / 'releases' / f'pipeline-automated-followups-{commit[:12]}-20261111'
    backup = ROOT / 'shared' / f'rollback-pipeline-automated-followups-{commit[:12]}-20261111'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    env, variables = compose_environment(app, meta)
    support = support_ids()
    inputs = sorted(set(meta['files'] + meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    for name, expected in PREIMAGES.items():
        saved = preimages / Path(name).name
        run('docker', 'cp', f'{APP}:/app/{name}', str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Rollback preimage hash mismatch')
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

    mounts = []
    for name in FILES:
        runtime = release / 'runtime' / name
        runtime.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        runtime.write_bytes(contents[name])
        runtime.chmod(0o644)
        mounts.append({'type': 'bind', 'source': str(runtime), 'target': '/app/' + name,
                       'read_only': True, 'bind': {'create_host_path': False}})
    overlay = release / 'compose.pipeline-automated-followups.json'
    overlay.write_text(json.dumps({'services': {'app': {'volumes': mounts}}}))
    overlay.chmod(0o644)
    verify_overlay(meta, env, overlay, mounts)
    helper = release / 'deploy' / 'pipeline-automated-followups-release.py'
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
        for name, data in contents.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime Pipeline file hash mismatch')
        for name in ('client/public/pipeline/reports.js', 'modules/platform/chatbot-followup-preview.js', 'routes/pipeline.js'):
            run('docker', 'exec', APP, 'node', '--check', '/app/' + name)
        run('docker', 'exec', APP, 'node', '-e', "const fs=require('fs');const r=fs.readFileSync('/app/client/public/pipeline/reports.js','utf8');const p=fs.readFileSync('/app/routes/pipeline.js','utf8');const f=fs.readFileSync('/app/modules/platform/chatbot-followup-preview.js','utf8');if(!r.includes('automatedFollowupsTitle')||!r.includes('requestAutomatedFollowups')||!p.includes('/reports/automated-follow-ups')||!f.includes('listForPipeline'))process.exit(2)")
        if support_ids() != support or current['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('An unrelated service or image changed')
        if current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlay):
            raise RuntimeError('Pipeline report overlay is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        route_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/user?page=lead-reports').strip()
        api_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/api/workspace/pipeline/reports/automated-follow-ups').strip()
        if route_status != '200' or api_status != '401':
            raise RuntimeError('Public route or API authentication verification failed')
        served = {}
        for name, url in {
            'client/public/pipeline/index.html': 'https://7network.live/pipeline/index.html',
            'client/public/pipeline/reports.js': 'https://7network.live/pipeline/reports.js?v=20261111-automated-followups1',
            'client/public/pipeline/pipeline.css': 'https://7network.live/pipeline/pipeline.css?v=20261111-automated-followups1',
            'client/public/pipeline/pipeline-theme.css': 'https://7network.live/pipeline/pipeline-theme.css?v=20261111-automated-followups1',
        }.items():
            body = run('curl', '-fsS', url).encode()
            served[name] = sha(body)
            if served[name] != sha(contents[name]):
                raise RuntimeError('Served Pipeline file hash mismatch')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appHealth': current['State'].get('Health', {}).get('Status'), 'appImage': current['Config']['Image'],
                  'appFiles': {name: sha(data) for name, data in contents.items()}, 'servedFiles': served,
                  'appOverlay': str(overlay), 'supportServicesUnchanged': True, 'healthz': '200',
                  'leadReportsRoute': route_status, 'anonymousAutomatedFollowupsApi': api_status, 'migration': 'none'}
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
    overlay = release / 'compose.pipeline-automated-followups.json'
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
            raise RuntimeError('Rollback file hash mismatch')
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
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'PIPELINE_REPORT_CHAT_LINK_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
