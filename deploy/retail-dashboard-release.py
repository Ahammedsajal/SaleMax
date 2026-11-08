"""Stage, deploy and restore the guarded Retail dashboard release."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
LATEST_OVERLAY = '/opt/salemax/releases/website-journey-compact-00f384bdeddc-20261108/compose.website-journey-compact.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
EXPECTED_COMPOSE_FILES = 174
EXPECTED_ENV_FILES = 11
EXPECTED_MOUNTS = 169
SUPPORT = (
    'salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
    'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db',
)
RUNTIME_FILES = (
    'client/public/business-dashboard/index.html',
    'client/public/business-dashboard/dashboard.js',
    'client/public/business-dashboard/dashboard.css',
    'modules/platform/retail-commerce-router.js',
)
STAGE_FILES = RUNTIME_FILES + ('deploy/retail-dashboard-release.py',)
OLD_HASHES = dict(zip(RUNTIME_FILES, (
    '1433e9575986552ff355320e82181c3a2f0c2555ca049227bf321f0f1bbf63f6',
    'e36147b829f16e9907de2a1e943ac440fc7a84e8d18b08392ff037ce03057281',
    '2b29d63994f8173ddb5c822b3a0ba580f11b5859bbf84dc4a2ea6401559e3e67',
    'd0cf46b580f30203e896bd05f4fa502d0d3acdc7f147e9ae3fbbd970ca3cbf6e',
)))
ROUTER_SMOKE = r"""
const assert = require('node:assert/strict');
const express = require('express');
const mysql = require('mysql2/promise');
const {randomUUID} = require('node:crypto');
const {getCategory} = require('./modules/platform/categories');
const {workspaceRouter} = require('./modules/platform/retail-commerce-router');
const pool = mysql.createPool({
  host:process.env.DBHOST, port:Number(process.env.DBPORT||3306),
  user:process.env.DBUSER, password:process.env.DBPASS, database:process.env.DBNAME
});
const tenantId = randomUUID();
const app = express();
app.use(workspaceRouter({pool,authenticate(req,res,next){
  const category = getCategory(req.get('x-test-category')||'retail_boutique',1);
  req.businessContext = {
    audience:'tenant', category,
    tenant:{id:tenantId,categoryKey:category.key,categoryVersion:1,status:'active',timezone:'Asia/Qatar'},
    membership:{id:randomUUID(),tenantId,role:req.get('x-test-role')||'owner',status:'active'},
    subscription:{status:'active',categoryKey:category.key,categoryVersion:1,capabilities:category.capabilities}
  };
  next();
}}));
app.use((_error,_req,res,_next)=>res.sendStatus(500));
const server = app.listen(0,'127.0.0.1',async()=>{
  try {
    const url = 'http://127.0.0.1:'+server.address().port+'/orders/overview';
    const allowed = await fetch(url+'?days=7');
    assert.equal(allowed.status,200);
    assert.match(allowed.headers.get('cache-control'),/no-store/);
    const {data} = await allowed.json();
    assert.deepEqual([data.orderCount,data.orderValueMinor,data.recentOrders.length],[0,'0',0]);
    assert.equal((await fetch(url,{headers:{'x-test-role':'agent'}})).status,403);
    assert.equal((await fetch(url,{headers:{'x-test-category':'training_center'}})).status,403);
    assert.equal((await fetch(url+'?days=365')).status,400);
    console.log(JSON.stringify({syntheticRetail:200,agent:403,trainingCenter:403,invalidPeriod:400}));
  } catch {
    console.error('Retail overview runtime probe failed');
    process.exitCode=1;
  } finally {
    server.close();
    await pool.end();
  }
});
"""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value, mode=0o600):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(mode)


def run(*args, env=None, input_data=None):
    result = subprocess.run(args, env=env, input=input_data, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for name in env_files:
        args += ['--env-file', name]
    for name in files:
        args += ['-f', name]
    return args


def wait_healthy():
    for _ in range(45):
        current = inspect(APP)
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')


def http_status(path, method='GET', payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request('https://7network.live' + path, data=data, method=method,
                                     headers={'Content-Type': 'application/json'} if data is not None else {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.read()


def stage(destination, commit):
    source = Path(__file__).resolve().parents[1]
    actual = run('git', '-C', str(source), 'rev-parse', 'HEAD').strip()
    dirty = run('git', '-C', str(source), 'status', '--porcelain', '--untracked-files=all').strip()
    if actual != commit or dirty:
        raise RuntimeError('Stage requires a clean checkout at the requested source commit')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if destination.exists():
        raise RuntimeError('Stage destination already exists')
    destination.mkdir(mode=0o700, parents=True)
    entries = {}
    try:
        for name in STAGE_FILES:
            data = (source / name).read_bytes()
            target = destination / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o600)
            entries[name] = sha(data)
        write_json(destination / 'source-manifest.json', {'sourceCommit': commit, 'files': entries}, 0o600)
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    print(json.dumps({'sourceCommit': commit, 'files': len(entries), 'stage': str(destination)}))


def validate_stage(folder, commit):
    manifest = json.loads((folder / 'source-manifest.json').read_text())
    if manifest.get('sourceCommit') != commit:
        raise RuntimeError('Staged source commit differs from requested release commit')
    files = {}
    for name in STAGE_FILES:
        path = folder / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('Staged source file is missing or not regular: ' + name)
        data = path.read_bytes()
        if manifest.get('files', {}).get(name) != sha(data):
            raise RuntimeError('Staged source hash mismatch: ' + name)
        files[name] = data
    return files


def prepare(app, files, env_files, workdir, stage_dir, commit, staged):
    if (len(files) != EXPECTED_COMPOSE_FILES or len(env_files) != EXPECTED_ENV_FILES
            or files[-1] != LATEST_OVERLAY or len(app['Mounts']) != EXPECTED_MOUNTS
            or app['Image'] != IMAGE):
        raise RuntimeError('Active app release chain differs from the reviewed production baseline')
    if not all(Path(name).is_file() for name in files + env_files):
        raise RuntimeError('An active Compose input is missing')
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError('Insufficient production disk space for a protected release snapshot')

    release = ROOT / 'releases' / f'retail-dashboard-{commit[:12]}-20261108'
    backup = ROOT / 'shared' / f'rollback-retail-dashboard-{commit[:12]}-20261108'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    release.chmod(0o755)
    backup.mkdir(mode=0o700)
    backup.chmod(0o700)
    write_json(backup / 'app-before.json', app)
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'source-commit.txt').write_text(commit + '\n')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    write_json(backup / 'compose-input-hashes.json', input_hashes)
    shutil.copytree(stage_dir, release / 'source-snapshot')
    for path in (release / 'source-snapshot').rglob('*'):
        if path.is_file():
            path.chmod(0o644)

    manual = json.loads(PRIOR_VARS.read_text()) if PRIOR_VARS.is_file() else {}
    supplied = {key for name in env_files for key in re.findall(
        r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in files for key in re.findall(
        r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live_env:
            variables[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable')
    write_json(backup / 'compose-vars.json', variables)
    env = dict(os.environ, **variables)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    runtime.chmod(0o755)
    for name, expected_hash in OLD_HASHES.items():
        target = '/app/' + name
        actual = run('docker', 'exec', APP, 'sha256sum', target).split()[0]
        if actual != expected_hash:
            raise RuntimeError('Live Retail source changed since review: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        saved.chmod(0o600)
        if sha(saved.read_bytes()) != actual:
            raise RuntimeError('Protected source preimage hash mismatch: ' + name)
    changed = {}
    for name in RUNTIME_FILES:
        target = '/app/' + name
        data = staged[name]
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        parent = output.parent
        while parent == runtime or runtime in parent.parents:
            parent.chmod(0o755)
            if parent == runtime:
                break
            parent = parent.parent
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.retail-dashboard.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'overlay-path.txt').write_text(str(overlay) + '\n')

    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    old_app, new_app = before['services']['app'], after['services']['app']
    old_volumes = {row['target']: row for row in old_app['volumes']}
    new_volumes = {row['target']: row for row in new_app['volumes']}
    expected = old_volumes.copy()
    expected.update({row['target']: row for row in mounts})
    if set(new_volumes) != set(expected):
        raise RuntimeError('Candidate app has unexpected mount targets')
    replacements = {row['target'] for row in mounts}
    for target, row in new_volumes.items():
        want = expected[target]
        if (row.get('type'), row.get('source'), row.get('read_only')) != (
                want.get('type'), want.get('source'), want.get('read_only')):
            raise RuntimeError('Candidate app mount changed unexpectedly: ' + target)
        if target in replacements:
            bind = row.get('bind') or {}
            if (set(bind) - {'create_host_path', 'propagation'} or bind.get('create_host_path', False)
                    or bind.get('propagation', 'rprivate') != 'rprivate'):
                raise RuntimeError('Candidate app bind options are not read-only and confined')
        elif row != old_volumes[target]:
            raise RuntimeError('An unrelated app mount changed: ' + target)
    old_app.pop('volumes')
    new_app.pop('volumes')
    if before != after:
        raise RuntimeError('Candidate Compose changes more than the reviewed app mounts')

    services = {name: inspect(name)['Id'] for name in SUPPORT}
    write_json(backup / 'support-services.json', services)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Active Compose input changed during release preparation')
    if inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app changed during release preparation')

    for name, data in changed.items():
        if name.endswith('.js'):
            run('docker', 'run', '--rm', '--network', 'none', '-v',
                str(runtime / name) + ':/verify.js:ro', '--entrypoint', 'node', IMAGE, '--check', '/verify.js')

    return release, backup, runtime, changed, overlay, common, candidate, env, services, expected


def verify_preimages(backup):
    for name, digest in OLD_HASHES.items():
        local = backup / 'preimages' / name
        if not local.is_file() or sha(local.read_bytes()) != digest:
            raise RuntimeError('Rollback source preimage is missing or altered: ' + name)


def deploy(stage_dir, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit) or os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release or source commit differs from the reviewed baseline')
    staged = validate_stage(stage_dir, commit)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    release, backup, runtime, changed, overlay, common, candidate, env, services, expected = prepare(
        app, files, env_files, workdir, stage_dir, commit, staged)

    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if (current['Image'] != app['Image'] or
                current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)])):
            raise RuntimeError('App image or active Compose chain changed unexpectedly')
        if len(current['Mounts']) != len(expected):
            raise RuntimeError('Unexpected app mount count after release')
        changed_targets = {'/app/' + name for name in changed}
        def unaffected_mounts(container):
            return {row['Destination']: row for row in container['Mounts']
                    if row['Destination'] not in changed_targets}
        if unaffected_mounts(current) != unaffected_mounts(app):
            raise RuntimeError('An unrelated runtime mount changed')
        for name, identity in services.items():
            if inspect(name)['Id'] != identity:
                raise RuntimeError('A supporting service changed during this app-only release')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime source hash mismatch: ' + name)

        health, _ = http_status('/healthz')
        shell_status, _ = http_status('/user?page=dashboard')
        api_status, _ = http_status('/api/workspace/retail/orders/overview?days=7')
        if health != 200 or shell_status != 200 or api_status not in (401, 403):
            raise RuntimeError('Health, dashboard shell or anonymous Retail API boundary check failed')
        smoke = json.loads(run('docker', 'exec', APP, 'node', '-e', ROUTER_SMOKE))
        for url, name in zip((
            '/business-dashboard/',
            '/business-dashboard/dashboard.js?v=20261108-retail1',
            '/business-dashboard/dashboard.css?v=20261108-retail1',
        ), RUNTIME_FILES):
            code, body = http_status(url)
            if code != 200 or sha(body) != sha(staged[name]):
                raise RuntimeError('Public dashboard asset differs from the reviewed release: ' + name)
        verify_preimages(backup)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'healthz': health, 'dashboardShell': shell_status, 'anonymousRetailApi': api_status,
                  'routerSmoke': smoke,
                  'hashes': {name: sha(data) for name, data in changed.items()}}
        write_json(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception:
        try:
            run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
            prior = wait_healthy()
            if (prior['Image'] != app['Image'] or
                    prior['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files)):
                raise RuntimeError('Automatic app rollback identity mismatch')
            for name, expected_hash in OLD_HASHES.items():
                if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected_hash:
                    raise RuntimeError('Automatic rollback preimage mismatch: ' + name)
        except Exception as rollback_error:
            raise RuntimeError('Retail deploy failed and automatic app rollback needs operator recovery') from rollback_error
        raise


def restore(backup):
    require_lock()
    base = (backup / 'base-release.txt').read_text().strip()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = Path((backup / 'overlay-path.txt').read_text().strip())
    if os.path.realpath(ROOT / 'current') != base:
        raise RuntimeError('Production base release changed')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later release is active; roll it back first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    verify_preimages(backup)
    prior = json.loads((backup / 'app-before.json').read_text())
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    if (current['Image'] != prior['Image'] or
            current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files)):
        raise RuntimeError('Rollback app or Compose identity mismatch')
    for name, digest in OLD_HASHES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
            raise RuntimeError('Rollback preimage mismatch: ' + name)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Supporting service changed during rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'supportServicesUnchanged': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'stage':
        stage(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: retail-dashboard-release.py stage <directory> <commit> | deploy <stage> <commit> | restore <rollback-directory>')
