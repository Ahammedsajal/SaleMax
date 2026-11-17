#!/usr/bin/env python3
"""Guarded app-only release for SES inbound Email Inbox replies."""
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
UI = 'client/public/email-marketing-workspace.js'
CSS = 'client/public/email-marketing-workspace.css'
ADMIN_UI = 'client/public/admin-email-marketing-settings.js'
SERVICE = 'modules/platform/email-marketing.js'
ROUTER = 'modules/platform/email-marketing-router.js'
PROVIDER = 'modules/platform/email-marketing-provider-settings.js'
WORKER = 'modules/platform/email-marketing-worker.js'
ADMIN_ROUTER = 'modules/platform/email-marketing-admin-router.js'
SNS = 'modules/platform/email-marketing-sns.js'
INBOUND = 'modules/platform/email-marketing-inbound.js'
INDEX = 'client/public/index.html'
MIGRATION = 'database/migrations/20270109_email_marketing_inbound.sql'
HELPER = 'deploy/email-marketing-inbox-release.py'
RUNTIME_FILES = (UI, CSS, ADMIN_UI, SERVICE, ROUTER, PROVIDER, WORKER, ADMIN_ROUTER, SNS, INBOUND, MIGRATION)
SOURCE_FILES = (*RUNTIME_FILES, INDEX, HELPER)
OLD_REFS = {
    b'/email-marketing-workspace.js?v=20261117-test-recipient1': b'/email-marketing-workspace.js?v=20261117-inbox-receiving1',
    b'/email-marketing-workspace.css?v=20261115-no-region-field1': b'/email-marketing-workspace.css?v=20261117-inbox-receiving1',
    b'/admin-email-marketing-settings.js?v=20261115-email-csrf1': b'/admin-email-marketing-settings.js?v=20261117-inbox-receiving1',
}
SIDEBAR_REF = b'/training-sidebar.js?v=20261117-email-marketing-nav1'
PREIMAGES = {
    UI: '8b563d90acd4f1c4144b17404124fadb08ac92c8836ac0157516a678bf59be0a',
    CSS: '1046f4f70cae3b7ad81ae2ab02052865d411e2ac3c6877929a9544a376d7bc8d',
    ADMIN_UI: 'a701834321e29db1b71b35c7639755f78b687880d2519ceb59a79a194bf334b5',
    SERVICE: 'e3505b5dc0448713e9b9aa8799406b7957a487347e295e495bfba42c95414f2d',
    ROUTER: '7155fca3b4dfd241f409ecbc85d96f1851debe2f096ef77fa3a76a76ec235cdf',
    PROVIDER: '9f438f9303eedaee9946a548b370647e56f113c585fc5696f8e5b496a34a8f73',
    WORKER: '55c9ec734fc5cf3463d27b3359bcf93a19fe33affb0ea3fd6cb81f81816ee01a',
    ADMIN_ROUTER: '5b1ffbc67bd3d8fce1d03c47d38ebab614518e9f22db6b1b9a76907b572be749',
    SNS: '67a00e650ef2006bdddf874532452ebc37e899da4eec435cbedef2e6f4b85d63',
    INBOUND: None,
    MIGRATION: None,
    INDEX: '4d7c9afa7d3e7b653d6175fc3afc434052bb56d14baed06b0dbcad07deb64863',
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
    if not files or not env_files or not workdir or not all(Path(p).is_file() for p in files + env_files):
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
            raise RuntimeError('Candidate is missing a reviewed read-only bind: ' + target)
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
    if stage_path.exists() or stage_path.is_symlink() or stage_path == source_root or source_root in stage_path.parents:
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
    if stage_path.is_symlink() or not stage_path.is_dir() or manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError('Stage or manifest is missing or invalid')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != set(SOURCE_FILES):
        raise RuntimeError('Stage manifest differs from reviewed source')
    for name, digest in manifest['files'].items():
        path = stage_path / 'source' / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Staged source hash mismatch: ' + name)
    index = (stage_path / 'source' / INDEX).read_bytes()
    if any(index.count(new) != 1 or old in index for old, new in OLD_REFS.items()) or index.count(SIDEBAR_REF) != 1:
        raise RuntimeError('Committed shell does not reference every reviewed inbound-email asset')
    ui = (stage_path / 'source' / UI).read_text()
    admin_ui = (stage_path / 'source' / ADMIN_UI).read_text()
    service = (stage_path / 'source' / SERVICE).read_text()
    router = (stage_path / 'source' / ROUTER).read_text()
    worker = (stage_path / 'source' / WORKER).read_text()
    inbound = (stage_path / 'source' / INBOUND).read_text()
    migration = (stage_path / 'source' / MIGRATION).read_text()
    if ('data-enable-replies' not in ui or 'data-refresh-inbound' not in ui or
            'domainVerificationStatus' not in service or "'/ses/inbound'" not in router or
            'data-inbound' not in admin_ui or 'ReplyToAddresses:[replyTo]' not in worker or
            'inbound_sns_message_id' not in migration or 'eventType' not in inbound or 'Received' not in inbound):
        raise RuntimeError('Staged files do not contain the reviewed inbound reply flow')
    return stage_path, manifest


def patch_live_index(data):
    if sha(data) != PREIMAGES[INDEX]:
        raise RuntimeError('Live workspace shell differs from the reviewed production preimage')
    if data.count(SIDEBAR_REF) != 1 or any(data.count(old) != 1 for old in OLD_REFS):
        raise RuntimeError('Live shell cache or Email Marketing sidebar reference changed')
    result = data
    for old, new in OLD_REFS.items():
        result = result.replace(old, new, 1)
    if any(result.count(new) != 1 or old in result for old, new in OLD_REFS.items()):
        raise RuntimeError('Live Email Marketing asset references could not be updated safely')
    return result


def public_check(expected_hashes):
    with urlopen('https://7network.live/healthz', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public health endpoint did not return HTTP 200')
    with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Public Email Marketing workspace did not return HTTP 200')
        shell = response.read()
    if SIDEBAR_REF not in shell or any(new not in shell or old in shell for old, new in OLD_REFS.items()):
        raise RuntimeError('Public shell does not reference the updated Email Marketing assets and sidebar')
    try:
        with urlopen('https://7network.live/api/workspace/email-marketing/setup', timeout=20) as response:
            status = response.status
    except HTTPError as error:
        status = error.code
    if status != 401:
        raise RuntimeError('Anonymous Email Marketing setup API did not return HTTP 401')
    asset_hashes = {}
    for file in (UI, CSS, ADMIN_UI):
        basename = Path(file).name.encode('ascii')
        ref = next(new.decode('ascii') for new in OLD_REFS.values() if b'/' + basename + b'?v=' in new)
        with urlopen('https://7network.live' + ref, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError('Updated public asset did not return HTTP 200: ' + file)
            asset = response.read()
        if sha(asset) != expected_hashes[file]:
            raise RuntimeError('Public asset hash mismatch: ' + file)
        asset_hashes[file] = expected_hashes[file]
    return {'healthz': 'HTTP 200', 'workspaceShell': 'HTTP 200',
            'anonymousSetupApi': 'HTTP 401', 'assets': asset_hashes}


def migration_status(filename):
    script = r"""
(async()=>{let c;try{const mysql=require('mysql2/promise');c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,multipleStatements:false});let rows=[];try{[rows]=await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[process.argv[1]])}catch(e){if(e.code!=='ER_NO_SUCH_TABLE')throw e}console.log(JSON.stringify({migration:rows[0]||null}));}catch(e){console.log(JSON.stringify({migrationError:e.code||e.name||'MIGRATION_STATUS_FAILED'}));process.exitCode=1}finally{try{await c?.end()}catch{}}})();
"""
    result = run('docker', 'exec', APP, 'node', '-e', script, filename)
    parsed = json.loads(result.splitlines()[-1])
    if parsed.get('migrationError'):
        raise RuntimeError(str(parsed['migrationError']))
    return parsed.get('migration')


def migration_schema_state():
    script = r"""
(async()=>{let c;try{const mysql=require('mysql2/promise');c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,multipleStatements:false});const [columns]=await c.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='sx_platform_email_provider_settings' AND column_name IN ('inbound_sns_topic_arn','inbound_sns_subscription_confirmed_at')) OR (table_name='sx_email_messages' AND column_name IN ('from_email','inbound_sns_message_id')))");const [tables]=await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='sx_email_inbound_domains'");const [indexes]=await c.query("SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='sx_email_messages' AND index_name='uq_sx_email_message_inbound_sns'");console.log(JSON.stringify({columns,tables,indexes}));}catch(e){console.log(JSON.stringify({migrationError:e.code||e.name||'SCHEMA_PROBE_FAILED'}));process.exitCode=1}finally{try{await c?.end()}catch{}}})();
"""
    result = run('docker', 'exec', APP, 'node', '-e', script)
    parsed = json.loads(result.splitlines()[-1])
    if parsed.get('migrationError'):
        raise RuntimeError(str(parsed['migrationError']))
    return parsed


def validate_migration_schema(ledger, schema):
    expected_columns = {
        ('sx_platform_email_provider_settings', 'inbound_sns_topic_arn'),
        ('sx_platform_email_provider_settings', 'inbound_sns_subscription_confirmed_at'),
        ('sx_email_messages', 'from_email'),
        ('sx_email_messages', 'inbound_sns_message_id'),
    }
    observed_columns = {(row['table_name'], row['column_name']) for row in schema['columns']}
    complete = (expected_columns.issubset(observed_columns) and
                bool(schema['tables']) and bool(schema['indexes']))
    any_new = bool(observed_columns or schema['tables'] or schema['indexes'])
    if ledger and ledger.get('status') == 'applied' and not complete:
        raise RuntimeError('Inbound migration ledger says applied but schema is incomplete')
    if not ledger and any_new:
        raise RuntimeError('Inbound migration schema exists without its migration ledger; operator reconciliation is required')
    if ledger and ledger.get('status') != 'applied':
        raise RuntimeError('Inbound migration ledger needs recovery before deployment')
    return complete


def apply_migration(filename, sql, staged_migrations):
    script = r"""
let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>body+=x);process.stdin.on('end',async()=>{let c;try{
 const input=JSON.parse(body),runner=require('/app/database/migration-runner'),crypto=require('node:crypto'),mysql=require('mysql2/promise');
 const migrations=runner.discover('/app/database/migrations');
 for(const [filename,sql] of Object.entries(input.migrations)){const checksum=crypto.createHash('sha256').update(sql,'utf8').digest('hex'),found=migrations.find(m=>m.file===filename);if(found&&found.checksum!==checksum)throw Object.assign(Error(),{code:'MIGRATION_CHECKSUM_CHANGED'});if(!found)migrations.push({file:filename,checksum,statements:runner.splitSql(sql)});}
 if(!input.migrations[input.filename])throw Object.assign(Error(),{code:'MIGRATION_NOT_FOUND'});
 migrations.sort((a,b)=>a.file.localeCompare(b.file));
 c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,multipleStatements:false});
 const applied=await runner.applyMigrations(c,migrations,{only:input.filename});
 const [rows]=await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[input.filename]);
 console.log(JSON.stringify({applied,migration:rows[0]||null}));
}catch(e){console.log(JSON.stringify({migrationError:e.code||e.name||'MIGRATION_FAILED'}));process.exitCode=1}finally{try{await c?.end()}catch{}}});
"""
    result = run('docker', 'exec', '-i', APP, 'node', '-e', script,
                 input_text=json.dumps({'filename': filename, 'migrations': staged_migrations}), timeout=900)
    parsed = json.loads(result.splitlines()[-1])
    if parsed.get('migrationError'):
        raise RuntimeError(str(parsed['migrationError']))
    row = parsed.get('migration') or {}
    if row.get('status') != 'applied' or int(row.get('statement_count', 0)) != int(row.get('statements_completed', -1)):
        raise RuntimeError('Inbound Email migration did not finish every statement')
    return {'applied': parsed.get('applied', []), 'migration': row}


def deploy(stage_path, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage_path, manifest = validate_stage(stage_path, commit)
    app = inspect(APP)
    db = inspect(DB)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
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
    prior = {}
    for name, expected in PREIMAGES.items():
        exists = subprocess.run(['docker', 'exec', APP, 'test', '-f', '/app/' + name], capture_output=True, text=True)
        if expected is None:
            if exists.returncode == 0:
                raise RuntimeError('A file expected to be new already exists in production: ' + name)
            if exists.returncode != 1:
                raise RuntimeError('Cannot inspect production preimage: ' + name)
            prior[name] = None
            continue
        if exists.returncode != 0:
            raise RuntimeError('Reviewed production preimage is missing: ' + name)
        data = run('docker', 'exec', APP, 'cat', '/app/' + name).encode()
        if sha(data) != expected:
            raise RuntimeError('Live file differs from reviewed preimage: ' + name)
        prior[name] = data
    changed = {name: (stage_path / 'source' / name).read_bytes() for name in RUNTIME_FILES}
    changed[INDEX] = patch_live_index(prior[INDEX])
    deployed_hashes = {name: sha(data) for name, data in changed.items()}
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    verify_live_compose_app(app, before)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-inbox-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-inbox-{commit[:12]}-{stamp}'
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
        if data is None:
            continue
        saved = preimages / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        saved.write_bytes(data)
        saved.chmod(0o600)
    for name, data in changed.items():
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-inbox.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'],
                                                        'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    helper_target = release / HELPER
    helper_target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    helper_target.write_bytes((stage_path / 'source' / HELPER).read_bytes())
    helper_target.chmod(0o644)
    migration_sql = (stage_path / 'source' / MIGRATION).read_text(encoding='utf-8')
    migration_before = migration_status(MIGRATION)
    schema_before = migration_schema_state()
    validate_migration_schema(migration_before, schema_before)
    if migration_before and migration_before.get('checksum') != hashlib.sha256(migration_sql.encode()).hexdigest():
        raise RuntimeError('Inbound migration checksum differs from the production ledger')
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
        'preimage-hashes.json': json.dumps({name: sha(data) if data is not None else None for name, data in prior.items()}, indent=2) + '\n',
        'email-inbound-migration-before.json': json.dumps({'migration': migration_before, 'schema': schema_before}, indent=2) + '\n',
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
        migration_result = apply_migration(MIGRATION, migration_sql, {MIGRATION: migration_sql})
        migration_after = migration_status(MIGRATION)
        schema_after = migration_schema_state()
        if not migration_after or migration_after.get('status') != 'applied' or not validate_migration_schema(migration_after, schema_after):
            raise RuntimeError('Inbound migration did not produce the expected schema')
        run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
            env=env, timeout=900)
        current = wait_healthy()
        expected_chain = ','.join(files + [str(overlay)])
        if current['Config']['Labels'].get('com.docker.compose.project.config_files') != expected_chain:
            raise RuntimeError('Unexpected active Compose chain')
        if current['Image'] != app['Image']:
            raise RuntimeError('App image changed unexpectedly')
        after_inventory = inventory()
        if {name: identity for name, identity in after_inventory.items() if name != APP} != {
                name: identity for name, identity in before_inventory.items() if name != APP}:
            raise RuntimeError('A non-app production container changed')
        for name, digest in deployed_hashes.items():
            observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
            if observed != digest:
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        runtime = run('docker', 'exec', APP, 'node', '-e', "for(const f of ['email-marketing','email-marketing-inbound','email-marketing-sns','email-marketing-provider-settings','email-marketing-router','email-marketing-admin-router','email-marketing-worker'])require('/app/modules/platform/'+f);console.log('modules-loaded')")
        if 'modules-loaded' not in runtime:
            raise RuntimeError('Inbound email runtime module load check failed')
        public = public_check(deployed_hashes)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'imageReference': current['Config']['Image'],
                  'composeInputs': len(files) + 1, 'environmentInputs': len(env_files),
                  'appMounts': len(current['Mounts']), 'migrationResult': migration_result,
                  'migrationBefore': migration_before, 'migrationAfter': migration_after,
                  'schemaBefore': schema_before, 'schemaAfter': schema_after,
                  'runtimeHashes': deployed_hashes,
                  'preimageHashes': {name: sha(data) if data is not None else None for name, data in prior.items()},
                  'nonAppContainersUnchanged': len(after_inventory) - 1,
                  'appHealthy': True, 'runtimeModuleCheck': 'passed',
                  'publicChecks': public, 'testEmailSent': False}
        write_private(backup / 'result.json', result)
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
    overlay = release / 'compose.email-marketing-inbox.json'
    migration_source = release / 'runtime' / MIGRATION
    if not migration_source.is_file() or migration_source.is_symlink():
        raise RuntimeError('Applied migration source is missing from the release')
    migration_digest = sha(migration_source.read_bytes())
    manifest = json.loads((backup / 'source-manifest.json').read_text())
    if manifest.get('files', {}).get(MIGRATION) != migration_digest:
        raise RuntimeError('Applied migration source differs from its release manifest')
    migration_overlay = backup / 'compose.email-marketing-inbound-migration.json'
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
    workdir = (backup / 'compose-working-dir.txt').read_text().strip()
    common = compose_args(files, env_files, workdir)
    before_config = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    migration_mount = {'type': 'bind', 'source': str(migration_source), 'target': '/app/' + MIGRATION,
                       'read_only': True, 'bind': {'create_host_path': False}}
    migration_overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'],
                                                                   'volumes': [migration_mount]}}}, indent=2) + '\n')
    migration_overlay.chmod(0o600)
    restored_chain = common + ['-f', str(migration_overlay)]
    restored_config = json.loads(run(*(restored_chain + ['config', '--format', 'json']), env=env))
    validate_candidate(before_config, restored_config, [migration_mount])
    run(*(restored_chain + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']),
        env=env, timeout=900)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if (current['Image'] != prior['imageId'] or current['Config']['Image'] != prior['image'] or
            current['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(files + [str(migration_overlay)])):
        raise RuntimeError('Prior app Compose chain did not restore')
    for name, digest in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if name == MIGRATION:
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != migration_digest:
                raise RuntimeError('Applied migration source was not preserved after rollback')
        elif digest is None:
            absent = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', '/app/' + name], capture_output=True, text=True)
            if absent.returncode != 0:
                raise RuntimeError('Rollback did not restore file absence: ' + name)
        elif run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != digest:
            raise RuntimeError('Rollback preimage hash mismatch: ' + name)
    if {name: identity for name, identity in inventory().items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed during rollback')
    ledger = migration_status(MIGRATION)
    schema = migration_schema_state()
    if not ledger or ledger.get('status') != 'applied' or not validate_migration_schema(ledger, schema):
        raise RuntimeError('Additive inbound schema did not remain intact after code rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'image': current['Config']['Image'], 'migrationsRetained': [MIGRATION],
                      'migrationSourcePreserved': str(migration_source),
                      'migrationSourceOverlay': str(migration_overlay)}))


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
