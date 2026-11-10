#!/usr/bin/env python3
"""Guarded app-only release for the tenant-scoped Pipeline follow-up brief."""
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
EXPECTED_APP_OVERLAY = '/opt/salemax/releases/training-owner-report-weekly-date-312064de5ab7-20261110/compose.training-owner-report-app.json'
APP = 'salemax-app-1'
UNCHANGED = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
             'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
EXPECTED_IMAGE = 'salemax-app:openai-ads-lead-01fde9e1-20261103'
PREIMAGES = {
    'routes/pipeline.js': '03815a5171b3f2dbb09fc3a99ff8579ba5ab61d47d8e6b1ed9d37238e40478bc',
    'client/public/pipeline/reports.js': '132a7e28d62afa6089e9aff5025815f3490e0ffe1fa2f2598bcc5421ab095154',
    'client/public/pipeline/pipeline.css': '17dddbd1b8082b42adcc68bf54fa9fbb57277146eb1fe2acae01ebd5040393ea',
    'client/public/pipeline/pipeline-theme.css': 'e17acc7872c37b8ecef885b0018b12d61fbecf23571096366b0a7de572d0a593',
    'client/public/pipeline/index.html': 'f9919f007af7a561970c245c2a430738a0b257d32fc3a9da686a414e3ba69c15',
}
NEW_FILES = ('modules/platform/pipeline-follow-up-brief.js',)
FILES = tuple(PREIMAGES) + NEW_FILES
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


def service_compose(info):
    labels = info['Config']['Labels']
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != 'app':
        raise RuntimeError('Unexpected app Compose identity')
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


def support_ids():
    return {name: inspect(name)['Id'] for name in UNCHANGED}


def verify_files(hashes):
    for name, expected in hashes.items():
        digest = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if digest != expected:
            raise RuntimeError('Runtime file hash mismatch: ' + name)


def verify_absent(names):
    for name in names:
        result = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', '/app/' + name], capture_output=True)
        if result.returncode:
            raise RuntimeError('Expected new runtime file to be absent: ' + name)


def mount_rows(release):
    return [{'type': 'bind', 'source': str(release / 'runtime' / name), 'target': '/app/' + name,
             'read_only': True, 'bind': {'create_host_path': False}} for name in FILES]


def validate_overlay(meta, env, overlay, mounts):
    common = compose_args(meta)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(common + ['-f', str(overlay), 'config', '--format', 'json']), env=env))
    if set(before['services']) != set(after['services']):
        raise RuntimeError('Candidate Compose changes the service set')
    old = before['services']['app']
    new = after['services']['app']
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
        document['services']['app'].pop('volumes', None)
    if before_copy != after_copy:
        raise RuntimeError('Candidate Compose changes service configuration beyond reviewed mounts')


def wait_app():
    for _ in range(45):
        info = inspect(APP)
        if info['State'].get('Health', {}).get('Status') == 'healthy':
            return info
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def compose_up(meta, env, overlay=None):
    args = compose_args(meta)
    if overlay:
        args += ['-f', str(overlay)]
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env)


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Production host or base release changed')


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if not all((stage / name).is_file() and not (stage / name).is_symlink() for name in FILES):
        raise RuntimeError('Staging directory is missing reviewed Pipeline files')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space')
    os.umask(0o077)
    app = inspect(APP)
    meta = service_compose(app)
    if app['Config']['Image'] != EXPECTED_IMAGE or app['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Active app health or image differs from reviewed baseline')
    if meta['files'][-1] != EXPECTED_APP_OVERLAY:
        raise RuntimeError('A newer app overlay is active')
    verify_files(PREIMAGES)
    verify_absent(NEW_FILES)
    release = ROOT / 'releases' / f'pipeline-follow-up-brief-{commit[:12]}-20261110'
    backup = ROOT / 'shared' / f'rollback-pipeline-follow-up-brief-{commit[:12]}-20261110'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    backup.mkdir(mode=0o700)
    release.mkdir(mode=0o755)
    env, variables = compose_environment(app, meta)
    before_state = {'id': app['Id'], 'image': app['Config']['Image'], 'compose': meta}
    inputs = sorted(set(meta['files'] + meta['env_files']))
    input_hashes = {name: sha(Path(name).read_bytes()) for name in inputs}
    (backup / 'app-before.json').write_text(json.dumps(before_state, indent=2) + '\n')
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, indent=2) + '\n')
    (backup / 'compose-vars.json').write_text(json.dumps(variables) + '\n')
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    support = support_ids()
    (backup / 'unchanged-services.json').write_text(json.dumps(support, indent=2) + '\n')
    preimages = {}
    for name, expected in PREIMAGES.items():
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        run('docker', 'cp', APP + ':/app/' + name, str(saved))
        digest = sha(saved.read_bytes())
        if digest != expected:
            raise RuntimeError('Rollback preimage hash mismatch: ' + name)
        preimages[name] = digest
    (backup / 'preimage-hashes.json').write_text(json.dumps(preimages, indent=2) + '\n')
    (backup / 'preimage-absent-files.json').write_text(json.dumps(list(NEW_FILES), indent=2) + '\n')
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    contents = {}
    for name in FILES:
        data = (stage / name).read_bytes()
        target = runtime / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        target.write_bytes(data)
        target.chmod(0o644)
        contents[name] = data
    overlay = release / 'compose.pipeline-follow-up-brief.json'
    mounts = mount_rows(release)
    overlay.write_text(json.dumps({'services': {'app': {'volumes': mounts}}}))
    overlay.chmod(0o644)
    validate_overlay(meta, env, overlay, mounts)
    own_helper = release / 'deploy/pipeline-follow-up-brief-release.py'
    own_helper.parent.mkdir(mode=0o755)
    own_helper.write_bytes(Path(__file__).read_bytes())
    own_helper.chmod(0o644)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed during preparation')
    if inspect(APP)['Id'] != app['Id'] or support_ids() != support:
        raise RuntimeError('A service changed during release preparation')
    try:
        compose_up(meta, env, overlay)
        current = wait_app()
        hashes = {name: sha(contents[name]) for name in FILES}
        verify_files(hashes)
        verify_absent(())
        run('docker', 'exec', APP, 'node', '-e', "require('/app/modules/platform/pipeline-follow-up-brief.js');require('/app/routes/pipeline.js');process.stdout.write('pipeline follow-up modules loaded\\n')")
        if support_ids() != support:
            raise RuntimeError('An unrelated service identity changed')
        if current['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('The app image changed')
        if current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlay):
            raise RuntimeError('Follow-up brief overlay is not active')
        run('curl', '-fsS', 'https://7network.live/healthz', '-o', '/dev/null')
        auth_status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://7network.live/api/pipeline/reports/follow-up-brief').strip()
        if auth_status != '401':
            raise RuntimeError('Follow-up report route did not enforce authentication')
        served = {}
        urls = {
            'client/public/pipeline/index.html': 'https://7network.live/pipeline/index.html',
            'client/public/pipeline/reports.js': 'https://7network.live/pipeline/reports.js?v=20261110-follow-up-brief3',
            'client/public/pipeline/pipeline.css': 'https://7network.live/pipeline/pipeline.css?v=20261110-follow-up-brief3',
            'client/public/pipeline/pipeline-theme.css': 'https://7network.live/pipeline/pipeline-theme.css?v=20261110-follow-up-brief3',
        }
        for name, url in urls.items():
            body = run('curl', '-fsS', url).encode()
            digest = sha(body)
            if digest != hashes[name]:
                raise RuntimeError('Served asset hash mismatch: ' + name)
            served[name] = digest
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup), 'baseRelease': BASE,
                  'appImage': current['Config']['Image'], 'appHealth': current['State'].get('Health', {}).get('Status'),
                  'appFiles': hashes, 'servedFiles': served, 'unchangedServices': list(support),
                  'appComposeInputs': len(current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')),
                  'migration': 'none', 'healthz': '200', 'anonymousReportApi': '401'}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
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
    overlay = release / 'compose.pipeline-follow-up-brief.json'
    current = inspect(APP)
    files = current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    if not files or files[-1] != str(overlay):
        raise RuntimeError('A later release is active; roll it back first')
    inputs = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in inputs.items()):
        raise RuntimeError('Rollback Compose inputs changed')
    variables = json.loads((backup / 'compose-vars.json').read_text())
    support = json.loads((backup / 'unchanged-services.json').read_text())
    if support_ids() != support:
        raise RuntimeError('An unrelated service changed; refusing rollback')
    compose_up(before['compose'], dict(os.environ, **variables))
    restored = wait_app()
    if restored['Config']['Image'] != before['image']:
        raise RuntimeError('Rollback image mismatch')
    verify_files(json.loads((backup / 'preimage-hashes.json').read_text()))
    verify_absent(json.loads((backup / 'preimage-absent-files.json').read_text()))
    if support_ids() != support:
        raise RuntimeError('Rollback changed an unrelated service')
    print(json.dumps({'rolledBack': str(release), 'appHealth': 'healthy', 'unchangedServices': list(support)}))


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
        print(message if re.fullmatch(r'[A-Za-z0-9_:/ .-]{1,180}', message) else 'PIPELINE_FOLLOW_UP_BRIEF_RELEASE_FAILED', file=sys.stderr)
        sys.exit(1)
