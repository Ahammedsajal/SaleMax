#!/usr/bin/env python3
"""Guarded app-only release for the Email Marketing visual template builder."""
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
SERVICE = 'modules/platform/email-marketing.js'
ROUTER = 'modules/platform/email-marketing-router.js'
WORKER = 'modules/platform/email-marketing-worker.js'
CONTENT = 'modules/platform/email-marketing-content.js'
BUILDER = 'client/public/email-marketing-template-builder.js'
UI_RUNTIME = 'client/public/email-marketing-workspace.js'
CSS_RUNTIME = 'client/public/email-marketing-workspace.css'
INDEX_RUNTIME = 'client/public/index.html'
MIGRATION_TEMPLATES = 'database/migrations/20270109_email_template_design.sql'
MIGRATION_CAMPAIGNS = 'database/migrations/20270110_email_campaign_design.sql'
MIGRATION_INBOUND = 'database/migrations/20270109_email_marketing_inbound.sql'
MIGRATION_INBOUND_LEDGER = 'database/migrations/20270109_email_marketing_inbound.sql'
MIGRATION_FILES = (MIGRATION_TEMPLATES, MIGRATION_CAMPAIGNS)
NEW_RUNTIME_FILES = (CONTENT, BUILDER, *MIGRATION_FILES)
RUNTIME_FILES = (SERVICE, ROUTER, WORKER, CONTENT, BUILDER, UI_RUNTIME, CSS_RUNTIME,
                 INDEX_RUNTIME, MIGRATION_TEMPLATES, MIGRATION_CAMPAIGNS,
                 'database/migration-runner.js', MIGRATION_INBOUND)
HELPER = 'deploy/email-marketing-visual-builder-release.py'
SOURCE_FILES = (*RUNTIME_FILES, HELPER)
PREIMAGE_SHA256 = {
    SERVICE: 'f9deb85b2810623994fbbf8dd7d8f1a547372b590d0e33712dca81d08b49e466',
    ROUTER: 'e677ad587a60f1a41a302da22a501a129f19ec0ee7000595c0d0c66e7aab4cd2',
    WORKER: '2d6712447a600a80c78aaa40fb07102df8c3ef092a75ccf57bb0488c2158a344',
    UI_RUNTIME: 'a1ff0a3d681e32602f50323a4bf51d4dd906fde1120adeb9d571d816728dcf13',
    CSS_RUNTIME: 'f9d09d43b2ab22de15a774a5ea7e6f5378f94a0ca2ea5167026e8c79cd354067',
    INDEX_RUNTIME: '4f7f901ff7c77942cfb93c73078a43f13cd671ebd234c4a1b426be082573e021',
    'database/migration-runner.js': 'ecd86db1d1fea857b22e83e5a87f0d477fbe467ff46ea4acc6db26261809230e',
    MIGRATION_INBOUND: 'd994927a0da0493e30488d5934f51fcb1d63d4cd3dc7bc4d29f85478639370d6',
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
    service_code = (stage_path / 'source' / SERVICE).read_text()
    worker_code = (stage_path / 'source' / WORKER).read_text()
    content_code = (stage_path / 'source' / CONTENT).read_text()
    builder_code = (stage_path / 'source' / BUILDER).read_text()
    ui_code = (stage_path / 'source' / UI_RUNTIME).read_text()
    css_code = (stage_path / 'source' / CSS_RUNTIME).read_text()
    index_code = (stage_path / 'source' / INDEX_RUNTIME).read_text()
    template_sql = (stage_path / 'source' / MIGRATION_TEMPLATES).read_text()
    campaign_sql = (stage_path / 'source' / MIGRATION_CAMPAIGNS).read_text()
    inbound_sql = stage_path / 'source' / MIGRATION_INBOUND
    migration_runner = (stage_path / 'source' / 'database/migration-runner.js').read_text()
    if (template_sql.strip() != 'ALTER TABLE sx_email_templates ADD COLUMN design_json JSON NULL DEFAULT NULL, ALGORITHM=INSTANT;' or
            campaign_sql.strip() != 'ALTER TABLE sx_email_campaigns ADD COLUMN design_json JSON NULL DEFAULT NULL, ALGORITHM=INSTANT;' or
            sha(inbound_sql.read_bytes()) != PREIMAGE_SHA256[MIGRATION_INBOUND] or
            "'20270109_email_marketing_inbound.sql': 'database/migrations/20270109_email_marketing_inbound.sql'" not in migration_runner or
            "'20270109_email_template_design.sql': 'database/migrations/20270109_email_template_design.sql'" not in migration_runner or
            "'20270110_email_campaign_design.sql': 'database/migrations/20270110_email_campaign_design.sql'" not in migration_runner or
            'design_json' not in service_code or 'renderDesignedHtml' not in worker_code or
            "ContentDisposition:inline?'INLINE':'ATTACHMENT'" not in worker_code or
            "['image','▧','Image','صورة']" not in builder_code or 'data-builder-preview' not in builder_code or
            "email-marketing-template-builder.js?v=20261119-email-visual-builder1" not in index_code or
            "email-marketing-workspace.js?v=20261119-email-visual-builder1" not in index_code or
            "email-marketing-workspace.css?v=20261119-email-visual-builder1" not in index_code or
            'SXEmailTemplateBuilder.open(template' not in ui_code or 'renderDesignedHtml' not in content_code or
            'em-builder-workspace' not in css_code):
        raise RuntimeError('Staged visual email builder, renderer, migration or cache references are invalid')
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
    for asset, version in ((BUILDER, '20261119-email-visual-builder1'),
                           (UI_RUNTIME, '20261119-email-visual-builder1'),
                           (CSS_RUNTIME, '20261119-email-visual-builder1')):
        url = '/' + Path(asset).name + '?v=' + version
        if url not in shell:
            raise RuntimeError('Email Marketing shell does not reference the cache-busted asset')
        with urlopen('https://7network.live' + url, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError('Email Marketing public asset did not return HTTP 200: ' + Path(asset).name)
            digest = sha(response.read())
        if digest != expected_hashes[asset]:
            raise RuntimeError('Email Marketing public asset hash mismatch: ' + Path(asset).name)
        public_assets[Path(asset).name] = digest
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
    try:
        with urlopen('https://7network.live/api/workspace/email-marketing/templates', timeout=20) as response:
            templates_status = response.status
    except HTTPError as error:
        templates_status = error.code
    if templates_status != 401:
        raise RuntimeError('Anonymous Email Marketing templates API did not return HTTP 401')
    return {'healthz': 'HTTP 200', 'workspace': 'HTTP 200', 'publicAssets': public_assets,
            'anonymousSetupApi': 'HTTP 401', 'anonymousAnalyticsApi': 'HTTP 401',
            'anonymousTemplatesApi': 'HTTP 401'}


def migration_probe(staged_migrations, legacy_migration, complete=False):
    script = r"""
let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>body+=x);process.stdin.on('end',async()=>{let c;try{
 const input=JSON.parse(body),crypto=require('node:crypto'),mysql=require('mysql2/promise');
 c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,multipleStatements:false});
 const [tables]=await c.query("SELECT TABLE_NAME,ENGINE FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_NAME IN ('sx_email_templates','sx_email_campaigns')");
 const [columns]=await c.query("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE FROM information_schema.columns WHERE table_schema=DATABASE() AND TABLE_NAME IN ('sx_email_templates','sx_email_campaigns') AND COLUMN_NAME='design_json'");
 const [ledgerTable]=await c.query("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_NAME='salemax_schema_migrations'");
 const ledger=ledgerTable.length?await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name IN ('+input.names.map(()=>'?').join(',')+')',input.names).then(x=>x[0]):[];
 const state={tables:Object.fromEntries(tables.map(x=>[x.TABLE_NAME,x.ENGINE])),columns:Object.fromEntries(columns.map(x=>[x.TABLE_NAME,x])),ledger:Object.fromEntries(ledger.map(x=>[x.migration_name,x]))};
 const legacy=state.ledger[input.legacy.name],legacyChecksum=crypto.createHash('sha256').update(input.legacy.sql,'utf8').digest('hex');
 if(!legacy||legacy.checksum!==legacyChecksum||legacy.status!=='applied'||Number(legacy.statement_count)!==3||Number(legacy.statements_completed)!==3)throw Object.assign(Error(),{code:'EMAIL_LEGACY_MIGRATION_STATE_MISMATCH'});
 for(const [filename,sql,table] of input.migrations){const row=state.ledger[filename],column=state.columns[table],checksum=crypto.createHash('sha256').update(sql,'utf8').digest('hex');if(!state.tables[table]||String(state.tables[table]).toLowerCase()!=='innodb')throw Object.assign(Error(),{code:'EMAIL_TABLE_NOT_INNODB'});if(row){if(row.checksum!==checksum||row.status!=='applied'||Number(row.statement_count)!==1||Number(row.statements_completed)!==1||!column||!['longtext','json'].includes(String(column.DATA_TYPE).toLowerCase())||column.IS_NULLABLE!=='YES')throw Object.assign(Error(),{code:'EMAIL_MIGRATION_STATE_MISMATCH'});}else if(column||input.complete)throw Object.assign(Error(),{code:column?'EMAIL_MIGRATION_SCHEMA_MISMATCH':'EMAIL_MIGRATION_NOT_APPLIED'});}
 if(Boolean(state.ledger[input.names[2]])&&!state.ledger[input.names[1]])throw Object.assign(Error(),{code:'EMAIL_MIGRATION_ORDER_MISMATCH'});
 console.log(JSON.stringify(state));
}catch(e){console.log(JSON.stringify({probeError:e.code||e.name||'EMAIL_SCHEMA_PROBE_FAILED'}));process.exitCode=1}finally{try{await c?.end()}catch{}}});
"""
    migrations = [[name, sql, table] for name, (sql, table) in staged_migrations.items()]
    result = json.loads(run('docker', 'exec', '-i', APP, 'node', '-e', script,
                            input_text=json.dumps({'names': [legacy_migration[0], *staged_migrations],
                                                   'legacy': {'name': legacy_migration[0], 'sql': legacy_migration[1]},
                                                   'migrations': migrations, 'complete': complete}),
                            timeout=60).splitlines()[-1])
    if result.get('probeError'):
        raise RuntimeError(str(result['probeError']))
    return result


def apply_migration(filename, sql, staged_migrations, legacy_migration):
    script = r"""
let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>body+=x);process.stdin.on('end',async()=>{let c;try{
 const input=JSON.parse(body),runner=require('/app/database/migration-runner'),crypto=require('node:crypto'),mysql=require('mysql2/promise');
 const migrations=runner.discover('/app/database/migrations');
 const legacy=input.legacy,legacyChecksum=crypto.createHash('sha256').update(legacy.sql,'utf8').digest('hex');
 const legacyBasename=legacy.name.split('/').pop(),legacyFile=migrations.find(m=>m.file===legacyBasename);
 if(!legacyFile||legacyFile.checksum!==legacyChecksum)throw Object.assign(Error(),{code:'LEGACY_MIGRATION_SOURCE_MISMATCH'});
 if(migrations.some(m=>m.file===legacy.name))throw Object.assign(Error(),{code:'LEGACY_MIGRATION_ALIAS_DUPLICATE'});
 migrations.push({file:legacy.name,checksum:legacyChecksum,statements:runner.splitSql(legacy.sql)});
 for(const [filename,sql] of Object.entries(input.migrations)){const checksum=crypto.createHash('sha256').update(sql,'utf8').digest('hex'),found=migrations.find(m=>m.file===filename);if(found&&found.checksum!==checksum)throw Object.assign(Error(),{code:'MIGRATION_CHECKSUM_CHANGED'});if(!found)migrations.push({file:filename,checksum,statements:runner.splitSql(sql)});}
 if(!input.migrations[input.filename])throw Object.assign(Error(),{code:'MIGRATION_NOT_FOUND'});
 migrations.sort((a,b)=>a.file.localeCompare(b.file));
 c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,charset:'utf8mb4',multipleStatements:false});
 const applied=await runner.applyMigrations(c,migrations,{only:input.filename});
 const [rows]=await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[input.filename]);
 console.log(JSON.stringify({applied,migration:rows[0]||null}));
}catch(e){console.log(JSON.stringify({migrationError:e.code||e.name||'MIGRATION_FAILED'}));process.exitCode=1}finally{try{await c?.end()}catch{}}});
"""
    migrations = {name: item[0] for name, item in staged_migrations.items()}
    legacy = {'name': legacy_migration[0], 'sql': legacy_migration[1]}
    output = run('docker', 'exec', '-i', APP, 'node', '-e', script,
                 input_text=json.dumps({'filename': filename, 'migrations': migrations,
                                        'legacy': legacy}), timeout=900)
    result = json.loads(output.splitlines()[-1])
    if result.get('migrationError'):
        raise RuntimeError(str(result['migrationError']))
    row = result.get('migration') or {}
    expected_checksum = sha(sql.encode('utf-8'))
    if (row.get('migration_name') != filename or row.get('checksum') != expected_checksum or
            row.get('status') != 'applied' or int(row.get('statement_count', 0)) != 1 or
            int(row.get('statements_completed', -1)) != 1):
        raise RuntimeError('Email design migration did not finish with the expected checksum and state')
    return row


def check_visual_builder():
    script = r"""
const content=require('/app/modules/platform/email-marketing-content');
const id='86c2d780-68d9-4d9f-a3cd-1cd87a23a105',attachments=[{id,fileName:'hero.png',contentType:'image/png',size:1200,content:Buffer.from('synthetic')}];
const design={version:1,blocks:[{type:'header',title:'Welcome {{first_name}}',subtitle:'A helpful update',align:'center',backgroundColor:'#9d174d',textColor:'#ffffff'},{type:'image',attachmentId:id,alt:'Product image',href:'https://7network.live/products'},{type:'text',text:'Hello <script>alert(1)</script>',align:'left',color:'#344054'},{type:'button',text:'Explore',href:'https://7network.live',align:'center',backgroundColor:'#9d174d',textColor:'#ffffff'}]};
const html=content.renderDesignedHtml(design,attachments,{contact:{name:'Amina Hassan'},personalize:value=>value.replace(/{{first_name}}/g,'Amina'),unsubscribeUrl:'https://7network.live/api/public/email/unsubscribe/synthetic.signature'});
if(!html.includes('cid:7network-image-86c2d78068d94d9fa3cd1cd87a23a105')||!html.includes('&lt;script&gt;')||html.includes('<script>')||!html.includes('href="https://7network.live"')||!html.includes('Unsubscribe / إلغاء الاشتراك'))throw Error('DESIGNED_EMAIL_RENDER_INVALID');
let rejected=false;try{content.cleanDesign({version:1,blocks:[{type:'button',text:'Unsafe',href:'javascript:alert(1)'}]},[]);}catch(error){rejected=error.code==='INVALID_EMAIL_DESIGN_URL';}if(!rejected)throw Error('UNSAFE_LINK_ACCEPTED');
console.log(JSON.stringify({structuredBlocks:'passed',cidImage:'passed',htmlEscaping:'passed',httpsButton:'passed',unsafeUrlRejected:'passed',unsubscribeLink:'passed'}));
"""
    output = run('docker', 'exec', APP, 'node', '-e', script, timeout=30)
    result = json.loads(output.splitlines()[-1])
    expected = {'structuredBlocks': 'passed', 'cidImage': 'passed', 'htmlEscaping': 'passed',
                'httpsButton': 'passed', 'unsafeUrlRejected': 'passed', 'unsubscribeLink': 'passed'}
    if result != expected:
        raise RuntimeError('Production HTML tracking or SES event configuration probe failed')
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
    prior = {}
    for name, expected in PREIMAGE_SHA256.items():
        data = run('docker', 'exec', APP, 'cat', '/app/' + name).encode()
        if sha(data) != expected:
            raise RuntimeError('Live Email Marketing runtime differs from the reviewed preimage: ' + name)
        prior[name] = data
    for name in NEW_RUNTIME_FILES:
        absent = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', '/app/' + name],
                                capture_output=True, text=True)
        if absent.returncode != 0:
            raise RuntimeError('A new visual-builder runtime path already exists in production: ' + name)
    staged_migrations = {
        MIGRATION_TEMPLATES: ((stage_path / 'source' / MIGRATION_TEMPLATES).read_text(), 'sx_email_templates'),
        MIGRATION_CAMPAIGNS: ((stage_path / 'source' / MIGRATION_CAMPAIGNS).read_text(), 'sx_email_campaigns'),
    }
    legacy_migration = (MIGRATION_INBOUND_LEDGER, (stage_path / 'source' / MIGRATION_INBOUND).read_text())
    schema_before = migration_probe(staged_migrations, legacy_migration)
    changed = {name: (stage_path / 'source' / name).read_bytes() for name in RUNTIME_FILES}
    deployed_hashes = {name: sha(data) for name, data in changed.items()}
    common = compose_args(files, env_files, workdir)
    before = json.loads(run(*(common + ['config', '--format', 'json']), env=env))
    verify_live_compose_app(app, before)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'email-marketing-visual-builder-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-email-marketing-visual-builder-{commit[:12]}-{stamp}'
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
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o644)
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-visual-builder.json'
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
        'preimage-hashes.json': json.dumps(PREIMAGE_SHA256, indent=2) + '\n',
        'support-services.json': json.dumps({name: identity for name, identity in before_inventory.items()
                                             if name != APP}, indent=2) + '\n',
        'source-manifest.json': json.dumps(manifest, indent=2) + '\n',
        'database-schema-before.json': json.dumps(schema_before, indent=2) + '\n',
        'database-migrations.json': json.dumps([], indent=2) + '\n',
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
        applied_migrations = []
        for name in MIGRATION_FILES:
            sql, _table = staged_migrations[name]
            applied_migrations.append(apply_migration(name, sql, staged_migrations, legacy_migration))
            write_private(backup / 'database-migrations.json',
                          json.dumps(applied_migrations, indent=2) + '\n')
        schema_after = migration_probe(staged_migrations, legacy_migration, complete=True)
        write_private(backup / 'database-schema-after.json',
                      json.dumps(schema_after, indent=2) + '\n')
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
                     "require('/app/modules/platform/email-marketing-worker');console.log('email-marketing-worker-loaded')")
        if 'email-marketing-worker-loaded' not in loaded:
            raise RuntimeError('Email Marketing module did not load')
        if inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Database did not remain healthy after the additive migrations')
        builder_probe = check_visual_builder()
        public = public_check(deployed_hashes)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'baseRelease': BASE, 'image': current['Image'], 'imageReference': current['Config']['Image'],
                  'composeInputs': len(files) + 1, 'environmentInputs': len(env_files),
                  'appMounts': len(current['Mounts']),
                  'runtimeHashes': deployed_hashes, 'preimageHashes': PREIMAGE_SHA256,
                  'nonAppContainersUnchanged': len(after_inventory) - 1,
                  'appHealthy': True, 'runtimeWorkerLoad': 'passed', 'visualBuilderProbe': builder_probe,
                  'publicChecks': public, 'emailSent': False, 'databaseChanged': True,
                  'migrations': applied_migrations, 'databaseSchema': schema_after}
        write_private(backup / 'result.json', result)
        print(json.dumps(result))
    except Exception:
        active = inspect(APP).get('Config', {}).get('Labels', {}).get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            restored = restore_chain(files, env_files, workdir, variables)
            if restored['Image'] != app['Image']:
                raise RuntimeError('Automatic rollback restored an unexpected app image')
            for name, expected in PREIMAGE_SHA256.items():
                observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
                if observed != expected:
                    raise RuntimeError('Automatic rollback did not restore the runtime preimage: ' + name)
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
    overlay = release / 'compose.email-marketing-visual-builder.json'
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
    restored = {}
    for name, expected in PREIMAGE_SHA256.items():
        observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0]
        if observed != expected:
            raise RuntimeError('Email Marketing rollback preimage hash mismatch: ' + name)
        restored[name] = observed
    if {name: identity for name, identity in inventory().items() if name != APP} != support_before:
        raise RuntimeError('A non-app production container changed during rollback')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'image': current['Config']['Image'], 'databaseChanged': True,
                      'additiveDesignMigrationsRetained': True,
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
