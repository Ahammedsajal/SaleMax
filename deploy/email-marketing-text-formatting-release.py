#!/usr/bin/env python3
"""Guarded, app-only production release for safe inline email formatting."""
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
from urllib.request import urlopen

ROOT = Path('/opt/salemax')
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
APP = 'salemax-app-1'
DB = 'salemax-db-1'
IMAGE_ID = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
IMAGE = 'salemax-app:email-marketing-21a07cc41fa9-20261112'
VERSION = '20261119-email-text-formatting1'
RUNTIME_FILES = (
    'modules/platform/email-marketing-content.js',
    'client/public/email-marketing-template-builder.js',
    'client/public/email-marketing-workspace.css',
    'client/public/index.html',
)
HELPER = 'deploy/email-marketing-text-formatting-release.py'
SOURCE_FILES = (*RUNTIME_FILES, HELPER)
PREIMAGE_SHA256 = {
    RUNTIME_FILES[0]: 'a33668ebd03ef0a76c28a9fa53fe3c8e66b1811231a227ec912ba37a8e1ed786',
    RUNTIME_FILES[1]: '09899cba97167947e9c34fb40c5b301b0d315487b5898b532359ff6a201c5c52',
    RUNTIME_FILES[2]: 'c74617ff70987424d7baf9a35f12ed60aa32916395d1fe33f5831a1f4b632a67',
    RUNTIME_FILES[3]: 'aed0ccfcc6eb62f285244c96476732fc2adf828615ee99c5e856d1687fa6a932',
}
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
            raise RuntimeError('Resolved Compose bind mount differs from running app')


def validate_candidate(before, after, mounts):
    expected = {row['target']: row for row in before['services']['app'].get('volumes', [])}
    actual = {row['target']: row for row in after['services']['app'].get('volumes', [])}
    for mount in mounts:
        target = mount['target']
        row = actual.pop(target, {})
        expected.pop(target, None)
        if any(row.get(key) != mount.get(key) for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate is missing a reviewed read-only bind')
    if actual != expected:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app = copy.deepcopy(before['services']['app'])
    after_app = copy.deepcopy(after['services']['app'])
    before_app.pop('volumes', None)
    after_app.pop('volumes', None)
    if before_app != after_app:
        raise RuntimeError('Candidate changes app configuration beyond file mounts')
    if {key: value for key, value in before['services'].items() if key != 'app'} != {
            key: value for key, value in after['services'].items() if key != 'app'}:
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
                raise RuntimeError('Reviewed source file is missing or is a symlink')
            data = run('git', '-C', str(source_root), 'show', f'{commit}:{name}').encode()
            if source.read_bytes() != data:
                raise RuntimeError('File differs from committed source: ' + name)
            target = stage_path / 'source' / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
            files[name] = sha(data)
        (stage_path / 'manifest.json').write_text(json.dumps({'sourceCommit': commit, 'files': files}, indent=2) + '\n')
        (stage_path / 'manifest.json').chmod(0o600)
    except Exception:
        shutil.rmtree(stage_path, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(stage_path), 'sourceCommit': commit, 'files': files}))


def validate_stage(stage_path, commit):
    stage_path = Path(stage_path).resolve()
    manifest_path = stage_path / 'manifest.json'
    if stage_path.is_symlink() or not stage_path.is_dir() or manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError('Stage or manifest is missing or invalid')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != set(SOURCE_FILES):
        raise RuntimeError('Stage manifest differs from reviewed source')
    for name, digest in manifest['files'].items():
        path = stage_path / 'source' / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Staged source hash mismatch')
    builder = (stage_path / 'source' / RUNTIME_FILES[1]).read_text()
    content = (stage_path / 'source' / RUNTIME_FILES[0]).read_text()
    index = (stage_path / 'source' / RUNTIME_FILES[3]).read_text()
    css = (stage_path / 'source' / RUNTIME_FILES[2]).read_text()
    if ('data-format=\"strong\"' not in builder or 'data-format=\"mark\"' not in builder or
            'contenteditable=\"true\"' not in builder or 'sanitizeInline' not in content or
            'renderInlineText' not in content or VERSION not in index or
            'em-builder-rich-editor' not in css):
        raise RuntimeError('Staged inline-formatting source is incomplete')
    return stage_path, manifest


def public_check(expected_hashes):
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public health endpoint did not return HTTP 200')
    with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public Email Marketing workspace did not return HTTP 200')
        shell = response.read().decode('utf-8', errors='replace')
    public_assets = {}
    for asset in RUNTIME_FILES[1:]:
        if asset.endswith('index.html'):
            continue
        url = '/' + Path(asset).name + '?v=' + VERSION
        if url not in shell:
            raise RuntimeError('Email Marketing shell lacks cache-versioned asset')
        with urlopen('https://7network.live' + url, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError('Public asset did not return HTTP 200')
            digest = sha(response.read())
        if digest != expected_hashes[asset]:
            raise RuntimeError('Public asset hash mismatch: ' + Path(asset).name)
        public_assets[Path(asset).name] = digest
    return {'healthz': 'HTTP 200', 'workspace': 'HTTP 200', 'assets': public_assets}


def check_inline_renderer():
    script = r"""
const c=require('/app/modules/platform/email-marketing-content');
const d=c.cleanDesign({version:1,blocks:[{type:'text',text:'Save <strong>time</strong>, <mark>never miss a lead</mark> & <script>alert(1)</script>',align:'left',color:'#344054'}]},[]);
const html=c.renderDesignedHtml(d,[],{personalize:x=>x}),plain=c.designToText(d);
if(!html.includes('<strong>time</strong>')||!html.includes('<mark style="background-color:#fff2a8;color:inherit">never miss a lead</mark>')||html.includes('<script>')||plain.includes('<strong>')||plain.includes('<mark>'))throw Error('INLINE_FORMAT_RENDER_INVALID');
let rejected=false;try{c.cleanDesign({version:1,blocks:[{type:'text',text:'<img src=x onerror=alert(1)>',align:'left',color:'#344054'}]},[]);}catch{rejected=true;}
if(rejected||html.includes('<img'))throw Error('INLINE_FORMAT_SANITIZER_INVALID');
console.log(JSON.stringify({bold:'passed',highlight:'passed',plainText:'passed',unsafeMarkup:'escaped'}));
"""
    result = json.loads(run('docker', 'exec', APP, 'node', '-e', script, timeout=30).splitlines()[-1])
    if result != {'bold': 'passed', 'highlight': 'passed', 'plainText': 'passed', 'unsafeMarkup': 'escaped'}:
        raise RuntimeError('Inline renderer probe failed')
    return result


def restore_chain(files, env_files, workdir, variables):
    env = dict(os.environ)
    env.update(variables)
    run(*(compose_args(files, env_files, workdir) +
          ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
        env=env, timeout=900)
    return wait_healthy()


def deploy(stage_path, commit):
    require_lock()
    stage_path, manifest = validate_stage(stage_path, commit)
    app, db = inspect(APP), inspect(DB)
    if (app['State'].get('Health', {}).get('Status') != 'healthy' or
            app['Image'] != IMAGE_ID or app['Config'].get('Image') != IMAGE):
        raise RuntimeError('Active app health or image differs from reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize < MINIMUM_FREE_BYTES:
        raise RuntimeError('Insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env, variables = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during preflight')
    prior = {}
    for name, expected in PREIMAGE_SHA256.items():
        data = run('docker', 'exec', APP, 'cat', '/app/' + name).encode()
        if sha(data) != expected:
            raise RuntimeError('Live runtime differs from reviewed preimage: ' + name)
        prior[name] = data
    changed = {name: (stage_path / 'source' / name).read_bytes() for name in RUNTIME_FILES}
    hashes = {name: sha(data) for name, data in changed.items()}
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    verify_live_compose_app(app, before)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-text-formatting-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-text-formatting-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    for name, data in prior.items():
        saved = preimages / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        saved.write_bytes(data)
        saved.chmod(0o600)
    for name, data in changed.items():
        target = runtime / name
        target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-text-formatting.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': IMAGE, 'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_copy = release / HELPER
    helper_copy.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_copy.write_bytes((stage_path / 'source' / HELPER).read_bytes())
    helper_copy.chmod(0o644)
    for name, value in {
        'app-before.json': json.dumps({'id': app['Id'], 'image': app['Config']['Image'], 'imageId': app['Image']}, indent=2) + '\n',
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'compose-vars.json': json.dumps(variables),
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'preimage-hashes.json': json.dumps(PREIMAGE_SHA256, indent=2) + '\n',
        'support-services.json': json.dumps({n: i for n, i in before_inventory.items() if n != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
    }.items():
        write_private(backup / name, value)
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
        if current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files + [str(overlay)]):
            raise RuntimeError('Unexpected active Compose chain')
        if current['Image'] != app['Image'] or current['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('App image changed unexpectedly')
        after_inventory = inventory()
        if {n: i for n, i in after_inventory.items() if n != APP} != {
                n: i for n, i in before_inventory.items() if n != APP}:
            raise RuntimeError('A non-app production container changed')
        for name, digest in hashes.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        run('docker', 'exec', APP, 'node', '-e',
            "require('/app/modules/platform/email-marketing-worker');console.log('worker-loaded')")
        if inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Database did not remain healthy')
        renderer = check_inline_renderer()
        public = public_check(hashes)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'imageReference': current['Config']['Image'],
                  'composeInputs': len(files) + 1, 'environmentInputs': len(env_files),
                  'appMounts': len(current['Mounts']), 'runtimeHashes': hashes,
                  'preimageHashes': PREIMAGE_SHA256, 'nonAppContainersUnchanged': len(after_inventory) - 1,
                  'appHealthy': True, 'databaseHealthy': True, 'databaseChanged': False,
                  'workerLoad': 'passed', 'inlineRenderer': renderer, 'publicChecks': public,
                  'emailSent': False}
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception:
        active = inspect(APP).get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            restored = restore_chain(files, env_files, workdir, variables)
            if restored['Image'] != app['Image']:
                raise RuntimeError('Automatic rollback restored unexpected app image')
            for name, expected in PREIMAGE_SHA256.items():
                if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
                    raise RuntimeError('Automatic rollback failed to restore: ' + name)
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
    overlay = release / 'compose.email-marketing-text-formatting.json'
    app = inspect(APP)
    active = app.get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
    if active != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later app overlay is active; restore it first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if not Path(name).is_file() or sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    support = json.loads((backup / 'support-services.json').read_text())
    if {n: i for n, i in inventory().items() if n != APP} != support:
        raise RuntimeError('A non-app production container changed since this release')
    prior = json.loads((backup / 'app-before.json').read_text())
    if app['Image'] != prior['imageId'] or app['Config']['Image'] != prior['image']:
        raise RuntimeError('Active app image differs from rollback snapshot')
    current = restore_chain(files, env_files, workdir, variables)
    if (current['Image'] != prior['imageId'] or current['Config']['Image'] != prior['image'] or
            current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files)):
        raise RuntimeError('Prior app Compose chain did not restore')
    restored = {}
    for name, digest in PREIMAGE_SHA256.items():
        observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if observed != digest:
            raise RuntimeError('Rollback preimage hash mismatch: ' + name)
        restored[name] = observed
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'image': current['Config']['Image'], 'databaseChanged': False,
                      'restoredRuntimeHashes': restored}))


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
