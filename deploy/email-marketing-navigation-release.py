#!/usr/bin/env python3
"""Guarded app-only release for the 7Network Sales Email Marketing sidebar."""
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
APP = 'salemax-app-1'
DB = 'salemax-db-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
SIDEBAR = 'client/public/training-sidebar.js'
INDEX = 'client/public/index.html'
HELPER = 'deploy/email-marketing-navigation-release.py'
NEW_SIDEBAR_REF = b'/training-sidebar.js?v=20261117-email-marketing-nav1'
OLD_SIDEBAR_REF = b'/training-sidebar.js?v=20261113-native-drawer-width1'
EXPECTED_SIDEBAR_PREIMAGE = '2b627a40e9a58c65b73581dc5c832cef404c2c2c892496ebe0901a0fc13224b9'
EXPECTED_SIDEBAR_RESULT = 'd6d7c73eaa14e7da4fcde58c887b9253a9a7c773b5dcb493f747f0093b5b18d4'
EXPECTED_INDEX_PREIMAGE = '78fa02c02436627f426d675024415c455d404573ae7afaea4ef3441552ba622a'
EXPECTED_INDEX_RESULT = 'fdce10dad7324761f6d1636e9b34449dc98143846df4ebe2e17ce489c59657af'
STAGE_FILES = (SIDEBAR, INDEX, HELPER)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(*args, env=None, input_text=None, check=True, timeout=600):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True,
                           text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed ({result.returncode})')
    return result


def inspect(name):
    return json.loads(run('docker', 'inspect', name).stdout)[0]


def inventory():
    names = run('docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=salemax',
                '--format', '{{.Names}}').stdout.splitlines()
    return {name: inspect(name)['Id'] for name in names}


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for name in env_files:
        args += ['--env-file', name]
    for name in files:
        args += ['-f', name]
    return args


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
    if run('hostname').stdout.strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def stage(source_root, stage_path, commit):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    source_root = Path(source_root).resolve()
    stage_path = Path(stage_path).resolve()
    if stage_path.exists() or stage_path == source_root or source_root in stage_path.parents:
        raise RuntimeError('Stage path exists or is inside the source checkout')
    if run('git', '-C', str(source_root), 'rev-parse', 'HEAD').stdout.strip() != commit:
        raise RuntimeError('Checkout does not match requested source commit')
    stage_path.mkdir(mode=0o700, parents=True)
    files = {}
    try:
        for name in STAGE_FILES:
            source = source_root / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('Reviewed source file is missing or is a symlink')
            committed = run('git', '-C', str(source_root), 'show', f'{commit}:{name}').stdout.encode()
            data = source.read_bytes()
            if data != committed:
                raise RuntimeError('File differs from committed source: ' + name)
            target_name = 'source/' + name
            target = stage_path / target_name
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
    if stage_path.is_symlink() or not stage_path.is_dir():
        raise RuntimeError('Stage directory is missing or is a symlink')
    manifest_path = stage_path / 'manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError('Stage manifest is missing or is a symlink')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != set(STAGE_FILES):
        raise RuntimeError('Stage manifest differs from reviewed source')
    for name, digest in manifest['files'].items():
        staged_name = 'source/' + name
        path = stage_path / staged_name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Staged source hash mismatch: ' + name)
    source_index = (stage_path / 'source' / INDEX).read_bytes()
    if source_index.count(NEW_SIDEBAR_REF) != 1:
        raise RuntimeError('Committed shell does not point to the versioned sidebar asset')
    source_sidebar = (stage_path / 'source' / SIDEBAR).read_text()
    if ("'Email Marketing'" not in source_sidebar or
            "['email','Email Marketing','التسويق عبر البريد الإلكتروني','campaign-dashboard&channel=email']" not in source_sidebar):
        raise RuntimeError('Committed sidebar source does not contain the reviewed email entry')
    return stage_path, manifest


def compose_context(app):
    labels = app.get('Config', {}).get('Labels') or {}
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if (not files or not env_files or not workdir or
            not all(Path(name).is_file() for name in files + env_files)):
        raise RuntimeError('Active Compose inputs are incomplete')
    return files, env_files, workdir


def compose_environment(app, files, env_files):
    referenced = set()
    supplied = set()
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
            raise RuntimeError('Missing Compose interpolation variable')
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


def patch_live_index(index):
    if sha(index) != EXPECTED_INDEX_PREIMAGE:
        raise RuntimeError('Live shell differs from reviewed production preimage')
    if index.count(OLD_SIDEBAR_REF) != 1 or index.count(b'/training-sidebar.js?v=') != 1:
        raise RuntimeError('Live shell sidebar asset reference changed')
    result = index.replace(OLD_SIDEBAR_REF, NEW_SIDEBAR_REF, 1)
    if sha(result) != EXPECTED_INDEX_RESULT:
        raise RuntimeError('Live-derived shell hash differs from reviewed result: ' + sha(result))
    return result


def patch_live_sidebar(sidebar):
    if sha(sidebar) != EXPECTED_SIDEBAR_PREIMAGE:
        raise RuntimeError('Live sidebar differs from reviewed production preimage')
    text = sidebar.decode('utf-8')
    patches = (
        ("'Campaign Dashboard', 'Web Notification'",
         "'Campaign Dashboard', 'Email Marketing', 'Web Notification'"),
        ("'Web Notifications': 'Web Notification', 'إشعارات الويب': 'Web Notification', 'لوحة التحكم': 'Dashboard'",
         "'Web Notifications': 'Web Notification', 'إشعارات الويب': 'Web Notification', 'Email': 'Email Marketing', 'التسويق عبر البريد الإلكتروني': 'Email Marketing', 'لوحة التحكم': 'Dashboard'"),
        ("'Campaign Dashboard':'campaign-dashboard', 'Lead Pipeline':'leads'",
         "'Campaign Dashboard':'campaign-dashboard', 'Email Marketing':'email', 'Lead Pipeline':'leads'"),
        ("      'Campaign Dashboard':['M3 11v3h4l9 5V6l-9 5z','M7 14l2 7h4l-3-8','M19 9a5 5 0 0 1 0 7'],\n",
         "      'Campaign Dashboard':['M3 11v3h4l9 5V6l-9 5z','M7 14l2 7h4l-3-8','M19 9a5 5 0 0 1 0 7'],\n      'Email Marketing':['M4 6h16v12H4z','m4 7 8 6 8-6'],\n"),
        ("      ['campaigns','Send Campaign','إرسال حملة','send-campaign'],['campaign-dashboard','Campaign Dashboard','لوحة الحملات','campaign-dashboard'],\n",
         "      ['campaigns','Send Campaign','إرسال حملة','send-campaign'],['campaign-dashboard','Campaign Dashboard','لوحة الحملات','campaign-dashboard'],\n      ['email','Email Marketing','التسويق عبر البريد الإلكتروني','campaign-dashboard&channel=email'],\n"),
        ("'Sales Finance':'sales-finance','Inventory':'business-inventory'",
         "'Sales Finance':'sales-finance','Campaign Dashboard':'campaign-dashboard','Email Marketing':'campaign-dashboard','Inventory':'business-inventory'"),
        ("let tooltip = name === 'Web Notification' ? tr('Web Notifications', 'إشعارات الويب') : text;",
         "let tooltip = name === 'Web Notification' ? tr('Web Notifications', 'إشعارات الويب') : name === 'Email Marketing' ? tr('Email Marketing', 'التسويق عبر البريد الإلكتروني') : text;"),
        ("const selected = row.dataset.sxSalesSection ? active===",
         "const channel=new URLSearchParams(location.search).get('channel'); const selected = name==='Email Marketing' ? active==='campaign-dashboard'&&channel==='email' : name==='Campaign Dashboard' ? active==='campaign-dashboard'&&channel!=='email' : row.dataset.sxSalesSection ? active==="),
        ("const captions = {Dashboard:['Dashboard','لوحة التحكم'], 'Web Notification':['Web Notifications','إشعارات الويب'], 'Create Meta Template':['Create Meta Template','إنشاء قالب Meta']};",
         "const captions = {Dashboard:['Dashboard','لوحة التحكم'], 'Web Notification':['Web Notifications','إشعارات الويب'], 'Email Marketing':['Email Marketing','التسويق عبر البريد الإلكتروني'], 'Create Meta Template':['Create Meta Template','إنشاء قالب Meta']};"),
        ("icp:'icp'};\n    const required=routeKeys[page];",
         "icp:'icp','campaign-dashboard':new URLSearchParams(location.search).get('channel')==='email'?'email':'campaign-dashboard'};\n    const required=routeKeys[page];"),
    )
    for old, new in patches:
        if text.count(old) != 1:
            raise RuntimeError('Live sidebar patch anchor changed: ' + old[:80])
        text = text.replace(old, new, 1)
    result = text.encode('utf-8')
    if sha(result) != EXPECTED_SIDEBAR_RESULT:
        raise RuntimeError('Live-derived sidebar hash differs from reviewed result: ' + sha(result))
    return result


def validate_candidate(before, after, mounts):
    expected = {row['target']: row for row in before['services']['app'].get('volumes', [])}
    actual = {row['target']: row for row in after['services']['app'].get('volumes', [])}
    for mount in mounts:
        target = mount['target']
        row = actual.pop(target, {})
        expected.pop(target, None)
        if any(row.get(key) != mount.get(key) for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate is missing reviewed read-only bind: ' + target)
    if actual != expected:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app, after_app = copy.deepcopy(before['services']['app']), copy.deepcopy(after['services']['app'])
    before_app.pop('volumes', None)
    after_app.pop('volumes', None)
    if before_app != after_app:
        raise RuntimeError('Candidate changes app configuration beyond file mounts')
    before_other = {key: value for key, value in before['services'].items() if key != 'app'}
    after_other = {key: value for key, value in after['services'].items() if key != 'app'}
    if before_other != after_other:
        raise RuntimeError('Candidate changes another service')


def public_check():
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public health endpoint did not return HTTP 200')
    for suffix in ('/', NEW_SIDEBAR_REF.decode('ascii')):
        with urlopen('https://7network.live' + suffix, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError('Public sidebar asset check failed')
            body = response.read()
        if suffix == '/':
            if NEW_SIDEBAR_REF not in body:
                raise RuntimeError('Public shell does not load the versioned sidebar asset')
        elif sha(body) != DEPLOYED_HASHES[SIDEBAR]:
            raise RuntimeError('Public sidebar asset hash mismatch')


DEPLOYED_HASHES = {}


def deploy(stage_path, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage_path, manifest = validate_stage(stage_path, commit)
    app = inspect(APP)
    db = inspect(DB)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Config']['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize < 4 * 1024**3:
        raise RuntimeError('Insufficient production disk space')
    files, env_files, workdir = compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    env, variables = compose_environment(app, files, env_files)
    before_inventory = inventory()
    if before_inventory.get(APP) != app['Id']:
        raise RuntimeError('App container changed during deployment preflight')
    sidebar_before = run('docker', 'exec', APP, 'cat', '/app/' + SIDEBAR).stdout.encode()
    index_before = run('docker', 'exec', APP, 'cat', '/app/' + INDEX).stdout.encode()
    if sha(sidebar_before) != EXPECTED_SIDEBAR_PREIMAGE:
        raise RuntimeError('Live sidebar differs from reviewed production preimage')
    index_after = patch_live_index(index_before)
    changed = {SIDEBAR: patch_live_sidebar(sidebar_before), INDEX: index_after}
    DEPLOYED_HASHES.update({name: sha(data) for name, data in changed.items()})
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env).stdout)
    verify_live_compose_app(app, before)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-navigation-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-navigation-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    preimage_hashes = {}
    for target, data in ((SIDEBAR, sidebar_before), (INDEX, index_before)):
        saved = preimages / target
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        saved.write_bytes(data)
        saved.chmod(0o600)
        preimage_hashes[target] = sha(data)
        output = runtime / target
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(changed[target])
        output.chmod(0o644)
    backup_files = {
        'app-before.json': {'id': app['Id'], 'image': app['Config']['Image'],
                            'health': app['State']['Health']['Status'],
                            'restartCount': app.get('RestartCount', 0)},
        'compose-files.before.txt': '\n'.join(files) + '\n',
        'compose-env-files.before.txt': '\n'.join(env_files) + '\n',
        'compose-working-dir.txt': workdir + '\n',
        'base-release.txt': BASE + '\n',
        'compose-vars.json': json.dumps(variables),
        'compose-input-hashes.json': json.dumps(input_hashes, indent=2) + '\n',
        'preimage-hashes.json': json.dumps(preimage_hashes, indent=2) + '\n',
        'support-services.json': json.dumps({name: identity for name, identity in before_inventory.items()
                                             if name != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'release-path.txt': str(release) + '\n',
    }
    for name, data in backup_files.items():
        (backup / name).write_text(data)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-navigation.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'],
                                                        'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_target = release / HELPER
    helper_target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_target.write_bytes((stage_path / HELPER).read_bytes())
    helper_target.chmod(0o644)

    candidate = common + ['-f', str(overlay)]
    after = json.loads(run(*(candidate + ['config', '--format', 'json']), env=env).stdout)
    validate_candidate(before, after, mounts)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during deployment preparation')
    if inventory() != before_inventory or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Production container inventory changed during deployment preparation')
    try:
        run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
            env=env, timeout=900)
        current = wait_healthy()
        expected_chain = ','.join(files + [str(overlay)])
        if current['Config']['Labels']['com.docker.compose.project.config_files'] != expected_chain:
            raise RuntimeError('Unexpected active Compose chain')
        if current['Config']['Image'] != app['Config']['Image']:
            raise RuntimeError('App image changed unexpectedly')
        after_inventory = inventory()
        if {name: identity for name, identity in after_inventory.items() if name != APP} != {
                name: identity for name, identity in before_inventory.items() if name != APP}:
            raise RuntimeError('A non-app production container changed')
        for target, digest in DEPLOYED_HASHES.items():
            observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + target).stdout.split()[0]
            if observed != digest:
                raise RuntimeError('Runtime file hash mismatch: ' + target)
        public_check()
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Config']['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'appMounts': len(current['Mounts']),
                  'migrations': 'none', 'runtimeHashes': DEPLOYED_HASHES,
                  'preimageHashes': preimage_hashes,
                  'nonAppContainersUnchanged': len(after_inventory) - 1,
                  'appHealthy': True, 'publicHealthz': 'HTTP 200', 'publicShellAndAsset': 'HTTP 200'}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        active = inspect(APP).get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            run(*(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
                env=env, timeout=900)
            wait_healthy()
        raise


def restore(backup_path):
    require_lock()
    backup = Path(backup_path).resolve()
    if not backup.is_relative_to(ROOT / 'shared') or not backup.is_dir():
        raise RuntimeError('Rollback snapshot is outside protected shared storage')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.email-marketing-navigation.json'
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
    variables = json.loads((backup / 'compose-vars.json').read_text())
    env = dict(os.environ)
    env.update(variables)
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
        env=env, timeout=900)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Config']['Image'] != prior['image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files):
        raise RuntimeError('Prior app Compose chain did not restore')
    for target, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + target).stdout.split()[0] != digest:
            raise RuntimeError('Rollback preimage hash mismatch: ' + target)
    if {name: identity for name, identity in inventory().items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed during rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'image': current['Config']['Image'], 'migrations': 'none'}))


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
