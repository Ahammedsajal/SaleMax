#!/usr/bin/env python3
"""Guarded app-only release for the Email Marketing analytics SQL fix."""
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
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path('/opt/salemax')
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
APP = 'salemax-app-1'
DB = 'salemax-db-1'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME = 'modules/platform/email-marketing.js'
HELPER = 'deploy/email-marketing-analytics-parse-fix-release.py'
SOURCE_FILES = (RUNTIME, HELPER)
PREIMAGE_SHA256 = 'd6154760142ed60f439fda0c044a88b43f3f26946728e02b68dba8656c7a51aa'
MINIMUM_FREE_BYTES = 4 * 1024**3


def run(*args, env=None, input_text=None, timeout=600):
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


def inventory():
    names = run('docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=salemax',
                '--format', '{{.Names}}').splitlines()
    return {name: inspect(name)['Id'] for name in names}


def compose_context(app):
    labels = app.get('Config', {}).get('Labels') or {}
    if (labels.get('com.docker.compose.project') != 'salemax' or
            labels.get('com.docker.compose.service') != 'app'):
        raise RuntimeError('Unexpected production app identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if (not files or not env_files or not workdir or
            not all(Path(path).is_file() for path in files + env_files)):
        raise RuntimeError('Active Compose inputs are incomplete')
    return files, env_files, workdir


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for path in env_files:
        args += ['--env-file', path]
    for path in files:
        args += ['-f', path]
    return args


def compose_environment(app, files, env_files):
    referenced, supplied = set(), set()
    for name in files:
        referenced.update(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text()))
    for name in env_files:
        supplied.update(re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M))
    live = dict(item.split('=', 1) for item in app['Config'].get('Env', []) if '=' in item)
    manual_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(manual_path.read_text()) if manual_path.is_file() else {}
    values = {}
    for key in referenced - supplied:
        if key in manual:
            values[key] = manual[key]
        elif key in live:
            values[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation input')
    env = dict(os.environ)
    for key in referenced:
        env.pop(key, None)
    env.update(values)
    return env, values


def verify_live_compose_app(app, config):
    service = config.get('services', {}).get('app') or {}
    if service.get('image') != app.get('Config', {}).get('Image'):
        raise RuntimeError('Resolved Compose image differs from running app')
    expected = {row['target']: row for row in service.get('volumes', []) if row.get('type') == 'bind'}
    actual = {row['Destination']: row for row in app.get('Mounts', []) if row.get('Type') == 'bind'}
    if set(expected) != set(actual):
        raise RuntimeError('Resolved Compose bind mounts differ from running app')
    for target, volume in expected.items():
        live = actual[target]
        if (os.path.realpath(volume.get('source', '')) != os.path.realpath(live.get('Source', '')) or
                bool(volume.get('read_only', False)) != (not bool(live.get('RW', True)))):
            raise RuntimeError('Resolved Compose bind mount differs from running app: ' + target)


def validate_candidate(before, after, mounts):
    expected = {row['target']: row for row in before['services']['app'].get('volumes', [])}
    actual = {row['target']: row for row in after['services']['app'].get('volumes', [])}
    for mount in mounts:
        target = mount['target']
        row = actual.pop(target, {})
        expected.pop(target, None)
        if any(row.get(key) != mount.get(key) for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate is missing the reviewed read-only bind: ' + target)
    if actual != expected:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app = copy.deepcopy(before['services']['app'])
    after_app = copy.deepcopy(after['services']['app'])
    before_app.pop('volumes', None)
    after_app.pop('volumes', None)
    if before_app != after_app:
        raise RuntimeError('Candidate changes app configuration beyond file mounts')
    before_other = {key: value for key, value in before['services'].items() if key != 'app'}
    after_other = {key: value for key, value in after['services'].items() if key != 'app'}
    if before_other != after_other:
        raise RuntimeError('Candidate changes another service')


def wait_healthy():
    for _ in range(60):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('App did not return to healthy state')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active production base release changed')


def stage(source_root, stage_path, commit):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    source_root = Path(source_root).resolve()
    stage_path = Path(stage_path).expanduser().absolute()
    if (stage_path.exists() or stage_path.is_symlink() or stage_path == source_root or
            source_root in stage_path.parents):
        raise RuntimeError('Stage path exists or is inside the source checkout')
    if run('git', '-C', str(source_root), 'rev-parse', 'HEAD').strip() != commit:
        raise RuntimeError('Checkout does not match requested source commit')
    stage_path.mkdir(mode=0o700, parents=True)
    files = {}
    try:
        for name in SOURCE_FILES:
            source = source_root / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('Reviewed source file is missing or is a symlink: ' + name)
            committed = run('git', '-C', str(source_root), 'show', f'{commit}:{name}').encode()
            data = source.read_bytes()
            if data != committed:
                raise RuntimeError('File differs from committed source: ' + name)
            target = stage_path / 'source' / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
            files[name] = sha(data)
        manifest = {'sourceCommit': commit, 'files': files}
        manifest_path = stage_path / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        manifest_path.chmod(0o600)
    except Exception:
        shutil.rmtree(stage_path, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(stage_path), 'sourceCommit': commit, 'files': files}))


def validate_stage(stage_path, commit):
    stage_path = Path(stage_path).resolve()
    manifest_path = stage_path / 'manifest.json'
    if (stage_path.is_symlink() or not stage_path.is_dir() or manifest_path.is_symlink() or
            not manifest_path.is_file()):
        raise RuntimeError('Stage or manifest is missing or invalid')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != set(SOURCE_FILES):
        raise RuntimeError('Stage manifest differs from reviewed source')
    for name, digest in manifest['files'].items():
        path = stage_path / 'source' / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Staged source hash mismatch: ' + name)
    code = (stage_path / 'source' / RUNTIME).read_text()
    if "AS \\`delayed\\`" not in code or "AS delayed\n" in code:
        raise RuntimeError('Staged analytics SQL does not safely quote the delayed alias')
    return stage_path, manifest


def public_check():
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public health endpoint did not return HTTP 200')
    with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public Email Marketing workspace did not return HTTP 200')
    try:
        with urlopen('https://7network.live/api/workspace/email-marketing/setup', timeout=20) as response:
            status = response.status
    except HTTPError as error:
        status = error.code
    if status != 401:
        raise RuntimeError('Anonymous Email Marketing setup API did not return HTTP 401')
    try:
        with urlopen('https://7network.live/api/workspace/email-marketing/analytics?days=7', timeout=20) as response:
            analytics_status = response.status
    except HTTPError as error:
        analytics_status = error.code
    if analytics_status != 401:
        raise RuntimeError('Anonymous Email Marketing analytics API did not return HTTP 401')
    return {'healthz': 'HTTP 200', 'workspace': 'HTTP 200', 'anonymousSetupApi': 'HTTP 401',
            'anonymousAnalyticsApi': 'HTTP 401'}


def check_live_analytics_sql():
    script = r"""
const config=require('/app/database/config');
(async()=>{
  const pool=config.promise(),db=await pool.getConnection();
  try{
    const [rows]=await db.query("SELECT COUNT(DISTINCT IF(event_type='Delivery',recipient_id,NULL)) AS delivered,COUNT(DISTINCT IF(event_type='Bounce',recipient_id,NULL)) AS bounced,COUNT(DISTINCT IF(event_type='Complaint',recipient_id,NULL)) AS complained,COUNT(DISTINCT IF(event_type='Open',recipient_id,NULL)) AS opened,COUNT(DISTINCT IF(event_type='Click',recipient_id,NULL)) AS clicked,COUNT(DISTINCT IF(event_type='Reject',recipient_id,NULL)) AS rejected,COUNT(DISTINCT IF(event_type='DeliveryDelay',recipient_id,NULL)) AS `delayed` FROM sx_email_provider_events WHERE tenant_id=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY)",[-1,7]);
    if(rows.length!==1||!Object.prototype.hasOwnProperty.call(rows[0],'delayed'))throw Error('ANALYTICS_DELAYED_METRIC_MISSING');
    console.log(JSON.stringify({eventMetricsQuery:'passed',periodDays:7,syntheticTenantNoMatch:true,delayedAlias:'present'}));
  }finally{db.release();await pool.end();}
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1});
"""
    output = run('docker', 'exec', APP, 'node', '-e', script, timeout=30)
    result = json.loads(output.splitlines()[-1])
    if result != {'eventMetricsQuery': 'passed', 'periodDays': 7,
                  'syntheticTenantNoMatch': True, 'delayedAlias': 'present'}:
        raise RuntimeError('Production Email Marketing analytics SQL probe did not return the expected result')
    return result


def restore_chain(files, env_files, workdir, variables, timeout=900):
    env = dict(os.environ)
    env.update(variables)
    args = compose_args(files, env_files, workdir)
    run(*(args + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
        env=env, timeout=timeout)
    return wait_healthy()


def deploy(stage_path, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage_path, manifest = validate_stage(stage_path, commit)
    app = inspect(APP)
    db = inspect(DB)
    if (app['State'].get('Health', {}).get('Status') != 'healthy' or
            app['Image'] != EXPECTED_IMAGE or app['Config'].get('Image') != 'salemax-app:email-marketing-21a07cc41fa9-20261112'):
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    stat = os.statvfs(ROOT)
    if stat.f_bavail * stat.f_frsize < MINIMUM_FREE_BYTES:
        raise RuntimeError('Insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env, variables = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during deployment preflight')
    preimage = run('docker', 'exec', APP, 'cat', '/app/' + RUNTIME).encode()
    if sha(preimage) != PREIMAGE_SHA256:
        raise RuntimeError('Live Email Marketing analytics module differs from the reviewed preimage')
    changed = {RUNTIME: (stage_path / 'source' / RUNTIME).read_bytes()}
    deployed_hashes = {RUNTIME: sha(data) for name, data in changed.items()}
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    verify_live_compose_app(app, before)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-analytics-parse-fix-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-analytics-parse-fix-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    saved = preimages / RUNTIME
    saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    saved.write_bytes(preimage)
    saved.chmod(0o600)
    for name, data in changed.items():
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-analytics-parse-fix.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'],
                                                        'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_target = release / HELPER
    helper_target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_target.write_bytes((stage_path / 'source' / HELPER).read_bytes())
    helper_target.chmod(0o644)
    backup_files = {
        'app-before.json': json.dumps({'id': app['Id'], 'image': app['Config']['Image'],
                                       'imageId': app['Image'], 'health': app['State']['Health']['Status'],
                                       'restartCount': app.get('RestartCount', 0)}, indent=2) + '\n',
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'base-release.txt': BASE + '\n',
        'compose-vars.json': json.dumps(variables),
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'preimage-hashes.json': json.dumps({RUNTIME: PREIMAGE_SHA256}, indent=2) + '\n',
        'support-services.json': json.dumps({name: identity for name, identity in before_inventory.items()
                                             if name != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
    }
    for name, data in backup_files.items():
        write_private(backup / name, data)

    candidate = common + ['-f', str(overlay)]
    after = json.loads(run(*(candidate + ['config', '--format', 'json']), env=env))
    validate_candidate(before, after, mounts)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during release preparation')
    if inventory() != before_inventory or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Production container inventory changed during release preparation')
    try:
        run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
            env=env, timeout=900)
        current = wait_healthy()
        expected_chain = ','.join(files + [str(overlay)])
        if current['Config']['Labels'].get('com.docker.compose.project.config_files') != expected_chain:
            raise RuntimeError('Unexpected active Compose chain')
        if current['Image'] != app['Image'] or current['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('App image changed unexpectedly')
        after_inventory = inventory()
        if {name: identity for name, identity in after_inventory.items() if name != APP} != {
                name: identity for name, identity in before_inventory.items() if name != APP}:
            raise RuntimeError('A non-app production container changed')
        for name, digest in deployed_hashes.items():
            observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
            if observed != digest:
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        loaded = run('docker', 'exec', APP, 'node', '-e',
                     "require('/app/modules/platform/email-marketing');console.log('email-marketing-module-loaded')")
        if 'email-marketing-module-loaded' not in loaded:
            raise RuntimeError('Email Marketing module did not load')
        analytics_probe = check_live_analytics_sql()
        public = public_check()
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'baseRelease': BASE, 'image': current['Image'], 'imageReference': current['Config']['Image'],
                  'composeInputs': len(files) + 1, 'environmentInputs': len(env_files),
                  'appMounts': len(current['Mounts']),
                  'runtimeHashes': deployed_hashes, 'preimageHashes': {RUNTIME: PREIMAGE_SHA256},
                  'nonAppContainersUnchanged': len(after_inventory) - 1,
                  'appHealthy': True, 'runtimeModuleLoad': 'passed', 'analyticsSqlProbe': analytics_probe,
                  'publicChecks': public, 'emailSent': False, 'databaseChanged': False}
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception:
        active = inspect(APP).get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            restored = restore_chain(files, env_files, workdir, variables)
            if restored['Image'] != app['Image']:
                raise RuntimeError('Automatic rollback restored an unexpected app image')
            observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + RUNTIME).split()[0]
            if observed != PREIMAGE_SHA256:
                raise RuntimeError('Automatic rollback did not restore the original analytics module')
        raise


def restore(backup_path):
    require_lock()
    backup = Path(backup_path).resolve()
    try:
        backup.relative_to(ROOT / 'shared')
    except ValueError:
        raise RuntimeError('Rollback snapshot is outside protected shared storage')
    if not backup.is_dir():
        raise RuntimeError('Rollback snapshot is missing')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    workdir = (backup / 'compose-working-dir.txt').read_text().strip()
    variables = json.loads((backup / 'compose-vars.json').read_text())
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.email-marketing-analytics-parse-fix.json'
    app = inspect(APP)
    active = app.get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
    if active != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later app overlay is active; restore it first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if not Path(name).is_file() or sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    support_before = json.loads((backup / 'support-services.json').read_text())
    current_inventory = inventory()
    if {name: identity for name, identity in current_inventory.items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed since this release')
    prior = json.loads((backup / 'app-before.json').read_text())
    if app['Image'] != prior['imageId'] or app['Config']['Image'] != prior['image']:
        raise RuntimeError('Active app image differs from rollback snapshot')
    current = restore_chain(files, env_files, workdir, variables)
    if (current['Image'] != prior['imageId'] or current['Config']['Image'] != prior['image'] or
            current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files)):
        raise RuntimeError('Prior app Compose chain did not restore')
    observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + RUNTIME).split()[0]
    if observed != PREIMAGE_SHA256:
        raise RuntimeError('Analytics module rollback preimage hash mismatch')
    if {name: identity for name, identity in inventory().items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed during rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'image': current['Config']['Image'], 'databaseChanged': False,
                      'restoredRuntimeHash': observed}))


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        restore(args[1])
    else:
        raise SystemExit('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'error': f'{type(error).__name__}: {error}'}), file=sys.stderr)
        raise SystemExit(1)
