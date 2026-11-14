#!/usr/bin/env python3
"""Guarded Email Marketing completion release; run only under production lock."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
EXPECTED_BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
MIGRATIONS = ('20270107_email_marketing_events.sql',
              '20270108_email_marketing_admin_and_analytics.sql')
ASSETS = {
    'client/public/index.html': None,
    'client/public/optional-feature-labels.js': 'client/public/optional-feature-labels.js',
    'client/public/optional-features.js': 'client/public/optional-features.js',
    'client/public/admin-email-marketing-settings.js': 'client/public/admin-email-marketing-settings.js',
    'client/public/email-marketing-workspace.js': 'client/public/email-marketing-workspace.js',
    'modules/platform/category-aliases.js': 'modules/platform/category-aliases.js',
    'modules/platform/policy.js': 'modules/platform/policy.js',
    'modules/platform/business-feature-session.js': 'modules/platform/business-feature-session.js',
    'modules/platform/optional-features.js': 'modules/platform/optional-features.js',
    'modules/platform/email-marketing-admin-router.js': 'modules/platform/email-marketing-admin-router.js',
    'modules/platform/email-marketing-provider-settings.js': 'modules/platform/email-marketing-provider-settings.js',
    'modules/platform/email-marketing-router.js': 'modules/platform/email-marketing-router.js',
    'modules/platform/email-marketing-ses.js': 'modules/platform/email-marketing-ses.js',
    'modules/platform/email-marketing-worker.js': 'modules/platform/email-marketing-worker.js',
    'modules/platform/email-marketing.js': 'modules/platform/email-marketing.js',
    'modules/platform/email-marketing-events.js': 'modules/platform/email-marketing-events.js',
    'modules/platform/email-marketing-sns.js': 'modules/platform/email-marketing-sns.js',
    'database/migrations/20270107_email_marketing_events.sql': 'database/migrations/20270107_email_marketing_events.sql',
    'database/migrations/20270108_email_marketing_admin_and_analytics.sql': 'database/migrations/20270108_email_marketing_admin_and_analytics.sql',
}
CACHE_REFS = {
    '/admin-email-marketing-settings.js?v=20261115-email-stockholm1': '/admin-email-marketing-settings.js?v=20261115-email-csrf1',
}


def run(*args, env=None, input_text=None, timeout=300):
    result = subprocess.run(args, env=env, input=input_text, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed ({result.returncode})')
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def compose_meta(app):
    labels = app.get('Config', {}).get('Labels') or {}
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != 'app':
        raise RuntimeError('Unexpected app service identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if not files or not env_files or not workdir or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return {'files': files, 'env_files': env_files, 'workdir': workdir}


def compose_args(meta):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', meta['workdir']]
    for path in meta['env_files']:
        args += ['--env-file', path]
    for path in meta['files']:
        args += ['-f', path]
    return args


def compose_environment(app, meta):
    live = dict(item.split('=', 1) for item in app['Config'].get('Env', []) if '=' in item)
    supplied = {key for path in meta['env_files'] for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(path).read_text(), re.M)}
    referenced = {key for path in meta['files'] for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(path).read_text())}
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


def health_wait():
    for _ in range(60):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != EXPECTED_BASE:
        raise RuntimeError('Active base release changed')


def database_probe():
    script = r"""
const mysql=require('mysql2/promise');
(async()=>{const c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,multipleStatements:false});try{
 const [ledger]=await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations');
 const [opt]=await c.query('SHOW CREATE TABLE sx_user_optional_features');
 const [provider]=await c.query('SHOW CREATE TABLE sx_platform_email_provider_settings');
 const [recipients]=await c.query('SHOW CREATE TABLE sx_email_campaign_recipients');
 const [tables]=await c.query("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_NAME='sx_email_provider_events'");
 const [eventIndex]=await c.query("SHOW INDEX FROM sx_email_campaign_recipients WHERE Key_name='uq_sx_email_recipient_id'");
 console.log(JSON.stringify({ledger,opt:opt[0]['Create Table'],provider:provider[0]['Create Table'],recipients:recipients[0]['Create Table'],eventsTable:tables.length===1,eventRecipientIndex:eventIndex.length===1}));
}finally{await c.end()}})().catch(e=>{console.log(JSON.stringify({probeError:e.code||e.name||'DATABASE_PROBE_FAILED'}));process.exitCode=1});
"""
    result = json.loads(run('docker', 'exec', APP, 'node', '-e', script, timeout=60).splitlines()[-1])
    if result.get('probeError'):
        raise RuntimeError(str(result['probeError']))
    return result


def validate_schema(result, staged_migrations, complete):
    rows = {row['migration_name']: row for row in result['ledger']}
    base = rows.get('20270106_email_marketing.sql')
    if not base or base['status'] != 'applied' or int(base['statements_completed']) != int(base['statement_count']):
        raise RuntimeError('Email foundation migration is not fully applied')
    applied = {}
    for name, sql in staged_migrations.items():
        row = rows.get(name)
        if row:
            if (row['status'] != 'applied' or row['checksum'] != sha(sql.encode('utf-8'))
                    or int(row['statement_count']) != len(sql.split(';')) - 1
                    or int(row['statements_completed']) != int(row['statement_count'])):
                raise RuntimeError('Email migration has unexpected state; reconcile it before deploy: ' + name)
        elif complete:
            raise RuntimeError('Email migration is not fully applied: ' + name)
        applied[name] = row is not None
    if applied[MIGRATIONS[1]] and not applied[MIGRATIONS[0]]:
        raise RuntimeError('Email analytics migration exists without its event migration')
    event = applied[MIGRATIONS[0]]
    analytics = applied[MIGRATIONS[1]]
    if (result['eventsTable'] != event or result['eventRecipientIndex'] != event
            or ('uq_sx_email_recipient_id' in result['recipients']) != event):
        raise RuntimeError('Email event schema does not match its migration ledger')
    if (('email_marketing' in result['opt']) != analytics
            or ('configuration_set_name' in result['provider']) != analytics
            or ('sns_topic_arn' in result['provider']) != analytics):
        raise RuntimeError('Email admin schema does not match its migration ledger')


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
        raise RuntimeError('Migration did not finish all statements')
    return row


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage = Path(stage).resolve()
    app = inspect(APP)
    db = inspect('salemax-db-1')
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('App health or image differs from reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if shutil_disk_free() < 4 * 1024**3:
        raise RuntimeError('Insufficient free space for guarded release')
    schema_before = database_probe()
    staged_migrations = {name: (stage / 'database' / 'migrations' / name).read_text(encoding='utf-8')
                         for name in MIGRATIONS}
    validate_schema(schema_before, staged_migrations, complete=False)
    meta = compose_meta(app)
    env, variables = compose_environment(app, meta)
    release = ROOT / 'releases' / f'email-marketing-completion-{commit[:12]}-20261114'
    backup = ROOT / 'shared' / f'rollback-email-marketing-completion-{commit[:12]}-20261114'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'database-before.json').write_text(json.dumps(schema_before, indent=2) + '\n')
    (backup / 'compose-files.before.txt').write_text('\n'.join(meta['files']) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(meta['env_files']) + '\n')
    (backup / 'compose-working-dir.txt').write_text(meta['workdir'] + '\n')
    (backup / 'base-release.txt').write_text(EXPECTED_BASE + '\n')
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    input_hashes = {path: sha(Path(path).read_bytes()) for path in meta['files'] + meta['env_files']}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, indent=2) + '\n')
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    changed = {}
    preimage_hashes = {}
    for target, source in ASSETS.items():
        live = '/app/' + target
        saved = preimages / target
        saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        exists = subprocess.run(['docker', 'exec', APP, 'test', '-f', live],
                                capture_output=True, text=True)
        if exists.returncode == 0:
            run('docker', 'cp', APP + ':' + live, str(saved))
            original = saved.read_bytes()
            if sha(original) != run('docker', 'exec', APP, 'sha256sum', live).split()[0]:
                raise RuntimeError('Live preimage changed: ' + target)
            preimage_hashes[target] = sha(original)
        elif exists.returncode == 1:
            original = None
            preimage_hashes[target] = None
        else:
            raise RuntimeError('Cannot inspect live preimage: ' + target)
        if source is None:
            if original is None:
                raise RuntimeError('Production shell is missing: ' + target)
            output = original.decode('utf-8')
            for old, new in CACHE_REFS.items():
                if output.count(old) != 1:
                    raise RuntimeError('Production shell cache reference changed: ' + old)
                output = output.replace(old, new)
            data = output.encode('utf-8')
        else:
            source_path = stage / source
            if not source_path.is_file() or source_path.is_symlink():
                raise RuntimeError('Missing reviewed source file: ' + source)
            data = source_path.read_bytes()
        dest = runtime / target
        dest.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        dest.write_bytes(data)
        dest.chmod(0o644)
        changed[target] = data
    (backup / 'preimage-hashes.json').write_text(json.dumps(preimage_hashes, indent=2) + '\n')
    support = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(support, indent=2) + '\n')
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.email-marketing-completion.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}, indent=2) + '\n')
    overlay.chmod(0o644)
    (release / 'deploy').mkdir(mode=0o755)
    helper_copy = release / 'deploy/email-marketing-full-release.py'
    helper_copy.write_bytes(Path(__file__).read_bytes())
    helper_copy.chmod(0o644)
    common = compose_args(meta)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    expected_volumes = {v['target']: v for v in before['services']['app']['volumes']}
    actual_volumes = {v['target']: v for v in after['services']['app']['volumes']}
    for mount in mounts:
        target = mount['target']
        actual = actual_volumes.pop(target, {})
        expected_volumes.pop(target, None)
        if any(actual.get(key) != mount[key] for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate lacks reviewed read-only mount: ' + target)
    if actual_volumes != expected_volumes:
        raise RuntimeError('Candidate changes unexpected app mounts')
    old_app, new_app = copy.deepcopy(before['services']['app']), copy.deepcopy(after['services']['app'])
    old_app.pop('volumes', None)
    new_app.pop('volumes', None)
    if old_app != new_app:
        raise RuntimeError('Candidate changes app configuration beyond file mounts')
    if {k: v for k, v in before['services'].items() if k != 'app'} != {k: v for k, v in after['services'].items() if k != 'app'}:
        raise RuntimeError('Candidate changes another service')

    migration_results = []
    try:
        for name in MIGRATIONS:
            path = stage / 'database' / 'migrations' / name
            if not path.is_file() or path.is_symlink():
                raise RuntimeError('Missing migration source: ' + name)
            migration_results.append(apply_migration(name, staged_migrations[name], staged_migrations))
        if any(sha(Path(path).read_bytes()) != digest for path, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
            raise RuntimeError('Running app or Compose inputs changed during migration')
        run(*(candidate + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=600)
        current = health_wait()
        if current['Image'] != app['Image']:
            raise RuntimeError('App image changed unexpectedly')
        if current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(meta['files'] + [str(overlay)]):
            raise RuntimeError('Unexpected active Compose chain')
        for name, identity in support.items():
            if inspect(name)['Id'] != identity:
                raise RuntimeError('Support service identity changed')
        hashes = {}
        for target, data in changed.items():
            observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + target).split()[0]
            if observed != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + target)
            hashes[target] = observed
        runtime = run('docker', 'exec', APP, 'node', '-e', "for(const f of ['email-marketing','email-marketing-sns','email-marketing-events','email-marketing-provider-settings','email-marketing-router','email-marketing-admin-router','business-feature-session','optional-features'])require('/app/modules/platform/'+f);console.log('modules-loaded')")
        if 'modules-loaded' not in runtime:
            raise RuntimeError('Runtime module load check failed')
        database_after = database_probe()
        validate_schema(database_after, staged_migrations, complete=True)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(meta['files']) + 1,
                  'mounts': len(current['Mounts']), 'migrationResults': migration_results,
                  'hashes': hashes, 'runtimeModuleCheck': 'passed',
                  'supportServicesUnchanged': True, 'databaseAfter': database_after}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        active = inspect(APP)['Config']['Labels'].get('com.docker.compose.project.config_files', '')
        if active.endswith(str(overlay)):
            run(*(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=600)
            health_wait()
        raise


def shutil_disk_free():
    return os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize


def restore(backup):
    require_lock()
    backup = Path(backup).resolve()
    if not backup.is_relative_to(ROOT / 'shared') or not backup.is_dir():
        raise RuntimeError('Rollback snapshot is outside the protected shared directory')
    meta = {'files': (backup / 'compose-files.before.txt').read_text().splitlines(),
            'env_files': (backup / 'compose-env-files.before.txt').read_text().splitlines(),
            'workdir': (backup / 'compose-working-dir.txt').read_text().strip()}
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.email-marketing-completion.json'
    app = inspect(APP)
    if not app['Config']['Labels'].get('com.docker.compose.project.config_files', '').endswith(str(overlay)):
        raise RuntimeError('A later app overlay is active; restore it first')
    for path, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(path).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    env = dict(os.environ)
    for key in json.loads((backup / 'compose-vars.json').read_text()):
        env.pop(key, None)
    env.update(json.loads((backup / 'compose-vars.json').read_text()))
    run(*(compose_args(meta) + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']), env=env, timeout=600)
    current = health_wait()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['Image']:
        raise RuntimeError('Rollback image mismatch')
    expected = json.loads((backup / 'preimage-hashes.json').read_text())
    for target in ASSETS:
        if expected[target] is None:
            absent = subprocess.run(['docker', 'exec', APP, 'test', '!', '-e', '/app/' + target],
                                    capture_output=True, text=True)
            if absent.returncode != 0:
                raise RuntimeError('Rollback did not restore file absence: ' + target)
            continue
        observed = run('docker', 'exec', APP, 'sha256sum', '/app/' + target).split()[0]
        if observed != expected[target]:
            raise RuntimeError('Rollback file hash mismatch: ' + target)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback changed a support service')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'migrationsRetained': list(MIGRATIONS)}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: email-marketing-full-release.py deploy <stage> <commit> | restore <rollback-dir>')
