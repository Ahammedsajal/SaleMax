#!/usr/bin/env python3
"""Guarded Email Marketing follow-up and sender verification release."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
DB = 'salemax-db-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
VERSION = '20261126-followup-resend1'
FILES = {
    'modules/platform/email-marketing.js': '/app/modules/platform/email-marketing.js',
    'modules/platform/email-marketing-router.js': '/app/modules/platform/email-marketing-router.js',
    'modules/platform/email-marketing-ses.js': '/app/modules/platform/email-marketing-ses.js',
    'modules/platform/email-marketing-worker.js': '/app/modules/platform/email-marketing-worker.js',
    'client/public/email-marketing-workspace.js': '/app/client/public/email-marketing-workspace.js',
    'client/public/admin-email-marketing-settings.js': '/app/client/public/admin-email-marketing-settings.js',
    'client/public/index.html': '/app/client/public/index.html',
}
PREIMAGE = {
    'modules/platform/email-marketing.js': '839c79313f6470daa852588c76f65a7cc9a6978366fa62e0f29f736e5b4fe2a4',
    'modules/platform/email-marketing-router.js': '69b7b51a60ab7a1e7dda6d22f5068d12e902660f2ee4b7245268c7ba76045148',
    'modules/platform/email-marketing-ses.js': '30e1f880aed44bee068a14dd08c4f8b1b56b370345329893d9670b2cca27e065',
    'modules/platform/email-marketing-worker.js': '78ad2a2cd0958e68467d61b768f6ecbc81221c469f0e073648337cd9a0f43691',
    'client/public/email-marketing-workspace.js': 'cf7c5494447136e6ec2b8c9e6651c6db04fb25a0097883f58e96d0ecfcedd46f',
    'client/public/admin-email-marketing-settings.js': '6d8df5305b94fc291a1850c1872e2d6d9c3b67d9c57fd5810a3c3c3b473cc1d0',
    'client/public/index.html': '3fd19e914b8c2cc1502d7dfa6b6c65318938044984730504fc36bdd381b1e41d',
}
MIGRATION = 'database/migrations/20270215_email_campaign_followups.sql'
HELPER = 'deploy/email-sender-verification-followup-release.py'
DOCKERFILE = 'deploy/Dockerfile.email-marketing-sdk'
SDK_FILES = ('deploy/email-marketing-sdk/package.json', 'deploy/email-marketing-sdk/package-lock.json')
SOURCE_FILES = (*FILES, MIGRATION, HELPER, DOCKERFILE, *SDK_FILES)


def run(*args, env=None, input_text=None, timeout=1800):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(Path(args[0]).name + ' failed: ' + result.stderr[-1000:])
    return result.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def stage(root_path, stage_path, commit):
    root = Path(root_path).resolve()
    target = Path(stage_path).expanduser().absolute()
    if target.exists() or target.is_symlink() or target == root or root in target.parents:
        raise RuntimeError('invalid or existing stage path')
    if run('git', '-C', str(root), 'rev-parse', 'HEAD').strip() != commit:
        raise RuntimeError('checkout does not match source commit')
    target.mkdir(mode=0o700, parents=True)
    manifest = {}
    try:
        for name in SOURCE_FILES:
            source = root / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('missing source: ' + name)
            data = subprocess.check_output(['git', '-C', str(root), 'show', f'{commit}:{name}'])
            if source.read_bytes() != data:
                raise RuntimeError('source is not committed: ' + name)
            output = target / 'source' / name
            output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            output.write_bytes(data)
            output.chmod(0o644)
            manifest[name] = digest(data)
        manifest_data = {'commit': commit, 'files': manifest}
        manifest_path = target / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest_data, indent=2) + '\n')
        manifest_path.chmod(0o600)
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(target), 'commit': commit, 'files': manifest}, indent=2))


def lock_check():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('expected root and protected production lock')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('active base release changed')


def compose_args(configs, workdir, extra=None):
    args = [
        'docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir,
        '--env-file', str(ROOT / 'shared/stack.env'), '--env-file', str(ROOT / 'shared/runtime.env'),
    ]
    for config in configs:
        args += ['-f', config]
    if extra:
        args += ['-f', str(extra)]
    return args


def compose_env(app, configs, workdir):
    env_files = [ROOT / 'shared/stack.env', ROOT / 'shared/runtime.env', Path(workdir) / '.env']
    manual = json.loads((ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json').read_text())
    supplied = {key for path in env_files if path.is_file() for key in re.findall(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=', path.read_text(), re.M)}
    supplied.update(os.environ)
    referenced = set()
    mounts = {mount['Destination']: mount['Source'] for mount in app.get('Mounts', [])}
    live = dict(value.split('=', 1) for value in app['Config'].get('Env', []) if '=' in value)
    for path in configs:
        referenced.update(match.group(1) for match in re.finditer(r'\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}', Path(path).read_text()) if not match.group(2).startswith((':-', '-', ':+', '+', '?')))
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live:
            variables[key] = live[key]
        elif key.endswith(('_BASE_IMAGE', '_APP_IMAGE')):
            variables[key] = app['Config']['Image']
        else:
            inferred, candidates = set(), []
            pattern = re.compile(r'\$\{' + re.escape(key) + r'(?::[-?+][^}]*)?\}([^:\s]*)\s*:\s*(/app/[^:\s]+)')
            for path in configs:
                content = Path(path).read_text()
                directory = Path(path).parent
                release_root = directory.parent if directory.name == 'deploy' else directory
                if '${' + key in content and release_root.parent.name == 'releases':
                    candidates.append(str(release_root))
                for suffix, destination in pattern.findall(content):
                    if release_root.parent.name == 'releases':
                        candidates.append(str(release_root))
                        continue
                    if destination in mounts and (not suffix or mounts[destination].endswith(suffix)):
                        inferred.add(mounts[destination][:-len(suffix)] if suffix else mounts[destination])
            if candidates:
                variables[key] = candidates[-1]
            elif len(inferred) == 1:
                variables[key] = inferred.pop()
            else:
                raise RuntimeError('cannot resolve required Compose variable: ' + key)
    return dict(os.environ, **variables)


def schema_probe():
    code = "const p=require('/app/database/config').promise();(async()=>{try{const [[c]]=await p.query(\"SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='sx_email_campaigns' AND column_name='follow_up_of_campaign_id') OR (table_name='sx_email_campaign_recipients' AND column_name='follow_up_source_recipient_id'))\");const [m]=await p.query(\"SELECT migration_name,status,checksum,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name='20270215_email_campaign_followups.sql'\");console.log(JSON.stringify({columns:Number(c.n),ledger:m}))}finally{await p.end()}})().catch(e=>{console.log(e.code||'db-probe-failed');process.exit(1)})"
    return json.loads(run('docker', 'exec', APP, 'node', '-e', code).splitlines()[-1])


def apply_migration(sql):
    code = r"""let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',async()=>{let c;try{const x=JSON.parse(s),r=require('/app/database/migration-runner'),crypto=require('node:crypto'),mysql=require('mysql2/promise'),name=x.name,checksum=crypto.createHash('sha256').update(x.sql,'utf8').digest('hex'),m=r.discover('/app/database/migrations');if(m.some(z=>z.file===name&&z.checksum!==checksum))throw Object.assign(Error(),{code:'MIGRATION_CHECKSUM_CHANGED'});if(!m.some(z=>z.file===name))m.push({file:name,checksum,statements:r.splitSql(x.sql)});m.sort((a,b)=>a.file.localeCompare(b.file));c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});await r.applyMigrations(c,m,{only:name});const [rows]=await c.query('SELECT migration_name,status,checksum,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[name]);console.log(JSON.stringify(rows[0]||{}))}catch(e){console.log(JSON.stringify({error:e.code||e.name||'migration-failed'}));process.exitCode=1}finally{try{await c?.end()}catch{}}});"""
    payload = {'name': MIGRATION.split('/')[-1], 'sql': sql}
    return json.loads(run('docker', 'exec', '-i', APP, 'node', '-e', code, input_text=json.dumps(payload)).splitlines()[-1])


def release_compose(name, release, previous, target_image):
    targets = {FILES[name]: str(release / 'runtime' / name) for name in FILES}
    volumes = []
    for destination, source in previous['mounts'].items():
        mode = previous['modes'][destination]
        entry = {'type': mode['type'], 'source': targets.get(destination, source), 'target': destination}
        if mode['read_only']:
            entry['read_only'] = True
        if mode['type'] == 'bind' and mode.get('propagation') not in (None, '', 'rprivate'):
            entry['bind'] = {'propagation': mode['propagation']}
        volumes.append(entry)
    for destination, source in targets.items():
        if destination not in previous['mounts']:
            volumes.append({'type': 'bind', 'source': source, 'target': destination, 'read_only': True})
    return {'services': {'app': {'image': target_image, 'volumes': volumes}}, 'name': 'salemax'}


def deploy(stage_path, commit):
    lock_check()
    stage_path = Path(stage_path).resolve()
    manifest = json.loads((stage_path / 'manifest.json').read_text())
    if manifest.get('commit') != commit or set(manifest.get('files', {})) != set(SOURCE_FILES):
        raise RuntimeError('stage manifest mismatch')
    files = {name: (stage_path / 'source' / name).read_bytes() for name in SOURCE_FILES}
    for name, data in files.items():
        if digest(data) != manifest['files'][name]:
            raise RuntimeError('stage file hash mismatch: ' + name)

    app, database = inspect(APP), inspect(DB)
    if app.get('Image') != IMAGE or app['State'].get('Health', {}).get('Status') != 'healthy' or database['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('app/database health or running image differs')
    if os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize < 4 * 1024**3:
        raise RuntimeError('less than 4 GiB free before build')
    for name, expected in PREIMAGE.items():
        actual = run('docker', 'exec', APP, 'sha256sum', FILES[name]).split()[0]
        if actual != expected:
            raise RuntimeError('live Email Marketing preimage changed: ' + name)
    prior_schema = schema_probe()
    if prior_schema != {'columns': 0, 'ledger': []}:
        raise RuntimeError('follow-up schema preimage differs')

    labels = app['Config']['Labels'] or {}
    configs = labels.get('com.docker.compose.project.config_files', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    service = labels.get('com.docker.compose.service')
    if not configs or not workdir or service != 'app' or any(not Path(path).is_file() for path in configs):
        raise RuntimeError('active Compose inputs are incomplete')
    env = compose_env(app, configs, workdir)
    before = json.loads(run(*(compose_args(configs, workdir) + ['config', '--format', 'json']), env=env))
    support = {name: inspect(name)['Id'] for name in run('docker', 'ps', '--filter', 'label=com.docker.compose.project=salemax', '--format', '{{.Names}}').splitlines() if name and name != APP}

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    name = f'email-followup-resend-{commit[:12]}-{stamp}'
    release = ROOT / 'releases' / name
    backup = ROOT / 'shared' / ('rollback-' + name)
    release.mkdir(mode=0o755)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    deploy_dir = release / 'deploy'
    deploy_dir.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    helper_copy = deploy_dir / Path(HELPER).name
    helper_copy.write_bytes(files[HELPER])
    helper_copy.chmod(0o644)
    for source_name in (DOCKERFILE, *SDK_FILES):
        output = deploy_dir / Path(source_name).name if source_name == DOCKERFILE else deploy_dir / 'email-marketing-sdk' / Path(source_name).name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(files[source_name])
        output.chmod(0o644)
    shutil.copytree(stage_path / 'source', release / 'build-context')

    previous = {
        'base': BASE, 'config_files': configs, 'workdir': workdir, 'service': service,
        'image': app['Config']['Image'], 'image_id': app['Image'], 'app_id': app['Id'],
        'support': support,
        'mounts': {mount['Destination']: mount['Source'] for mount in app.get('Mounts', [])},
        'modes': {mount['Destination']: {'type': mount['Type'], 'read_only': not mount.get('RW', True), 'propagation': mount.get('Propagation')} for mount in app.get('Mounts', [])},
    }
    (backup / 'state.json').write_text(json.dumps(previous, indent=2) + '\n')
    (backup / 'state.json').chmod(0o600)
    for source_name, target in FILES.items():
        prior = backup / (source_name.replace('/', '_') + '.before')
        run('docker', 'cp', APP + ':' + target, str(prior))
        prior.chmod(0o600)

    index = (backup / 'client_public_index.html.before').read_text()
    old_keys = (
        'email-marketing-workspace.js?v=20261126-campaign-delete1',
        'admin-email-marketing-settings.js?v=20261117-inbox-receiving1',
    )
    new_keys = (
        'email-marketing-workspace.js?v=' + VERSION,
        'admin-email-marketing-settings.js?v=' + VERSION,
    )
    for old, new in zip(old_keys, new_keys):
        if index.count(old) != 1:
            raise RuntimeError('live shell cache reference changed: ' + old)
        index = index.replace(old, new, 1)
    for source_name in FILES:
        target = runtime / source_name
        target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        target.write_bytes(index.encode() if source_name == 'client/public/index.html' else files[source_name])
        target.chmod(0o644)
    migration_path = runtime / MIGRATION
    migration_path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    migration_path.write_bytes(files[MIGRATION])
    migration_path.chmod(0o644)

    image_tag = f'salemax-app:email-followup-resend-{commit[:12]}-{stamp}'
    build_context = stage_path / 'source'
    run('docker', 'build', '--build-arg', 'BASE_IMAGE=' + IMAGE,
        '--label', 'org.7network.source-commit=' + commit,
        '--label', 'org.opencontainers.image.revision=' + commit,
        '-t', image_tag, '-f', str(build_context / DOCKERFILE), str(build_context))
    sdk_check = "const ses=require('@aws-sdk/client-ses'),sesv2=require('@aws-sdk/client-sesv2');if(typeof ses.SESClient!=='function'||typeof ses.VerifyEmailIdentityCommand!=='function'||typeof sesv2.SESv2Client!=='function')process.exit(2);console.log(JSON.stringify({ses:'ready',verifyEmailIdentity:'ready',sesv2:'ready'}))"
    sdk = json.loads(run('docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', image_tag, '-e', sdk_check).strip().splitlines()[-1])
    image_id = run('docker', 'image', 'inspect', '--format', '{{.Id}}', image_tag).strip()
    if sdk != {'ses': 'ready', 'verifyEmailIdentity': 'ready', 'sesv2': 'ready'} or not image_id.startswith('sha256:'):
        raise RuntimeError('candidate SES SDK image validation failed')

    overlay = deploy_dir / ('compose.' + name + '.json')
    overlay.write_text(json.dumps(release_compose(name, release, previous, image_tag), indent=2) + '\n')
    overlay.chmod(0o640)
    after = json.loads(run(*(compose_args(configs, workdir, overlay) + ['config', '--format', 'json']), env=env))
    if {key: value for key, value in before['services'].items() if key != 'app'} != {key: value for key, value in after['services'].items() if key != 'app'}:
        raise RuntimeError('release overlay changes another service')
    old_app, new_app = dict(before['services']['app']), dict(after['services']['app'])
    old_app.pop('image', None)
    new_image = new_app.pop('image', None)
    old_app.pop('volumes', None)
    new_volumes = new_app.pop('volumes', [])
    new_app.pop('volumes', None)
    if old_app != new_app or new_image != image_tag or len(new_volumes) != len(release_compose(name, release, previous, image_tag)['services']['app']['volumes']):
        raise RuntimeError('release overlay changes app configuration or mounts unexpectedly')

    migration = apply_migration(files[MIGRATION].decode())
    if migration.get('status') != 'applied' or int(migration.get('statement_count', 0)) != 2 or int(migration.get('statements_completed', -1)) != 2:
        raise RuntimeError('follow-up migration did not apply cleanly')
    run(*(compose_args(configs, workdir, overlay) + ['up', '-d', '--no-deps', '--no-build', service]), env=env)
    for _ in range(50):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(2)
    else:
        raise RuntimeError('app did not become healthy')
    if app.get('Image') != image_id:
        raise RuntimeError('running app image does not match candidate image')
    for container, identity in support.items():
        if inspect(container)['Id'] != identity:
            raise RuntimeError('non-app service changed: ' + container)

    schema = schema_probe()
    expected_migration = digest(files[MIGRATION])
    if schema.get('columns') != 2 or len(schema.get('ledger', [])) != 1 or schema['ledger'][0].get('status') != 'applied' or schema['ledger'][0].get('checksum') != expected_migration:
        raise RuntimeError('follow-up schema or migration checksum verification failed')
    hashes = {source_name: digest((runtime / source_name).read_bytes()) for source_name in FILES}
    for source_name, target in FILES.items():
        if run('docker', 'exec', APP, 'sha256sum', target).split()[0] != hashes[source_name]:
            raise RuntimeError('runtime file hash mismatch: ' + source_name)
    for source_name in ('modules/platform/email-marketing.js', 'modules/platform/email-marketing-router.js', 'modules/platform/email-marketing-ses.js', 'modules/platform/email-marketing-worker.js', 'client/public/email-marketing-workspace.js', 'client/public/admin-email-marketing-settings.js'):
        run('docker', 'exec', APP, 'node', '--check', FILES[source_name])
    run('docker', 'exec', APP, 'node', '-e', "require('/app/modules/platform/email-marketing-ses');require('/app/modules/platform/email-marketing-router')")
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('health endpoint did not return HTTP 200')
    with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email', timeout=20) as response:
        shell = response.read().decode('utf8', 'replace')
        if response.status != 200 or VERSION not in shell:
            raise RuntimeError('live workspace shell did not return updated cache keys')
    public_hashes = {}
    for source_name in ('client/public/email-marketing-workspace.js', 'client/public/admin-email-marketing-settings.js'):
        url = 'https://7network.live/' + Path(source_name).name + '?v=' + VERSION
        with urlopen(url, timeout=30) as response:
            body = response.read()
            if response.status != 200 or digest(body) != hashes[source_name]:
                raise RuntimeError('public JavaScript does not match the mounted release: ' + Path(source_name).name)
        public_hashes[Path(source_name).name] = {'status': 200, 'sha256': hashes[source_name]}
    anonymous_checks = {}
    for path, method, body in (
        ('/api/workspace/email-marketing/campaigns', 'GET', None),
        ('/api/workspace/email-marketing/campaigns/00000000-0000-4000-8000-000000000000/follow-up/preview', 'POST', b'{}'),
        ('/api/workspace/email-marketing/senders/00000000-0000-4000-8000-000000000000/resend-verification', 'POST', b'{}'),
    ):
        request = Request('https://7network.live' + path, data=body, method=method, headers={'Content-Type': 'application/json', 'Origin': 'https://7network.live'})
        try:
            with urlopen(request, timeout=20) as response:
                status = response.status
        except Exception as error:
            status = getattr(error, 'code', None)
        if status != 401:
            raise RuntimeError('anonymous protected API did not return HTTP 401: ' + path)
        anonymous_checks[path] = status
    result = {
        'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
        'imageTag': image_tag, 'imageId': app['Image'], 'candidateSdk': sdk,
        'appHealthy': True, 'databaseHealthy': inspect(DB)['State']['Health']['Status'] == 'healthy',
        'migration': migration, 'migrationChecksum': expected_migration,
        'runtimeHashes': hashes, 'publicAssets': public_hashes, 'anonymousApis': anonymous_checks,
        'healthHttp': 200, 'workspaceShellHttp': 200,
        'supportServicesUnchanged': len(support), 'emailSent': False,
    }
    (backup / 'deployment.json').write_text(json.dumps(result, indent=2) + '\n')
    (backup / 'deployment.json').chmod(0o600)
    print(json.dumps(result, indent=2))


def restore(snapshot_path):
    lock_check()
    snapshot = Path(snapshot_path)
    previous = json.loads((snapshot / 'state.json').read_text())
    if previous.get('base') != BASE:
        raise RuntimeError('rollback base differs')
    app = inspect(APP)
    current = (app.get('Config', {}).get('Labels') or {}).get('com.docker.compose.project.config_files', '').split(',')
    if current[:len(previous['config_files'])] != previous['config_files'] or len(current) != len(previous['config_files']) + 1 or 'email-followup-resend-' not in current[-1]:
        raise RuntimeError('follow-up release is not the sole newest app overlay')
    env = compose_env(app, previous['config_files'], previous['workdir'])
    volumes = []
    for destination, source in previous['mounts'].items():
        mode = previous['modes'][destination]
        entry = {'type': mode['type'], 'source': source, 'target': destination}
        if mode['read_only']:
            entry['read_only'] = True
        if mode['type'] == 'bind' and mode.get('propagation') not in (None, '', 'rprivate'):
            entry['bind'] = {'propagation': mode['propagation']}
        volumes.append(entry)
    overlay = snapshot / 'compose.restore.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': previous['image'], 'volumes': volumes}}, 'name': 'salemax'}, indent=2) + '\n')
    overlay.chmod(0o600)
    before = json.loads(run(*(compose_args(previous['config_files'], previous['workdir']) + ['config', '--format', 'json']), env=env))
    after = json.loads(run(*(compose_args(previous['config_files'], previous['workdir'], overlay) + ['config', '--format', 'json']), env=env))
    if {key: value for key, value in before['services'].items() if key != 'app'} != {key: value for key, value in after['services'].items() if key != 'app'}:
        raise RuntimeError('rollback overlay changes another service')
    run(*(compose_args(previous['config_files'], previous['workdir'], overlay) + ['up', '-d', '--no-deps', '--no-build', previous['service']]), env=env)
    for _ in range(50):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(2)
    else:
        raise RuntimeError('app did not recover after rollback')
    if app.get('Image') != previous['image_id']:
        raise RuntimeError('restored app image differs from rollback snapshot')
    for container, identity in previous['support'].items():
        if inspect(container)['Id'] != identity:
            raise RuntimeError('support service changed during rollback: ' + container)
    print(json.dumps({'restored': True, 'rollback': str(snapshot), 'appHealthy': True, 'additiveMigrationRetained': MIGRATION, 'imageId': app['Image']}))


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        restore(args[1])
    else:
        raise SystemExit('usage: helper stage SOURCE_ROOT STAGE COMMIT | deploy STAGE COMMIT | restore SNAPSHOT')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        raise SystemExit(1)
