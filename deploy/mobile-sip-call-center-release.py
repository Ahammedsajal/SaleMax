#!/usr/bin/env python3
"""Prepare and deploy a guarded, app-only mobile SIP Call Center overlay.

The only database change is the additive remote_number column. Asterisk,
firewall, Nginx, gateway, SIM, DID and SIP listener state are not changed.
"""
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
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
ACTIVE_OVERLAY = '/opt/salemax/releases/website-mobile-hero-tighten-f90174a12560-20261112/compose.website-mobile-hero-tighten.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
PROJECT = 'salemax'
MIGRATION = 'database/migrations/20261112_telephony_call_remote_number.sql'
HELPER = 'deploy/mobile-sip-call-center-release.py'
RELEASE_DAY = '20261112'

RUNTIME_FILES = (
    'client/public/call-center/index.html',
    'client/public/call-center/call-center.js',
    'client/public/call-center/sip-runtime.js',
    'modules/platform/asterisk-call-control.js',
    'modules/platform/asterisk-config.js',
    'modules/platform/asterisk-gateway-ports.js',
    'modules/platform/call-center-router.js',
    'modules/platform/category-aliases.js',
    'modules/platform/categories.js',
    'modules/platform/legacy-pipeline-actor.js',
    'modules/platform/plans.js',
    'modules/platform/policy.js',
    'modules/platform/telephony-call-coaching.js',
    'modules/platform/telephony-call-leads.js',
    'modules/platform/telephony-call-outcomes.js',
    'modules/platform/telephony-extensions.js',
    'modules/platform/telephony-queues.js',
    MIGRATION,
)

# Exact live-container hashes read during the source review. Any drift stops
# deployment so a newer production overlay is never silently replaced.
EXPECTED_PREIMAGES = {
    'client/public/call-center/index.html': 'b4a13464075aad9406a58e3790a0a85b8489b05cddea0005c8402d65982a4f25',
    'client/public/call-center/call-center.js': '8f71ce412740c3d587a8de55070faa906a3e96370f38ce5b3fecaa42202d3d27',
    'client/public/call-center/sip-runtime.js': '5db60e6e20c1f600cde5483178f9043cf7a7bd56368963f509f9cc4af6ff4fae',
    'modules/platform/asterisk-call-control.js': 'f21c785c398bd431cc1dd609c64108fdcb78899962bd891eb894daa5a58f46e7',
    'modules/platform/asterisk-config.js': '12529997a23c2dc00719cb4b06f40cf530e56bf4fd6ce038e9a962e481d202b6',
    'modules/platform/asterisk-gateway-ports.js': '7edfdc2dedbc07ba40a18c89912567b59810ab15aa62a37ca8b06bf368a11917',
    'modules/platform/call-center-router.js': 'a70d53bdf2549977229ce097c683bd2bc5d7899b155cb4f12c6d840226c0362b',
    'modules/platform/categories.js': '9e4c55fc9b44d25bef8ba7c438392a22eef4064aa30fd3f331b5db1c34656ddf',
    'modules/platform/legacy-pipeline-actor.js': '392c08a91f6b77d018f11fc64efbf296a8f393170c3b82cc626b07b6bbedfd42',
    'modules/platform/plans.js': '53eb3d76d8e2ad4668d57f2f3b1d07654de1f6c7633e9821d027c79b53138a79',
    'modules/platform/policy.js': '99a0475bc2822514003e0b202554b0c2423577073ce790c091b12cc11ead129d',
    'modules/platform/telephony-call-coaching.js': 'c651d2d43f16fa1757113fead7101231f846d96723aba22630cc087afac4f079',
    'modules/platform/telephony-call-leads.js': 'fe272e83796643c0f343755619b48f442543476b8b9ad36602f32c9279986ce8',
    'modules/platform/telephony-call-outcomes.js': 'a4b173bb6139bd4955eebfc93a78c98f81a9c1d29a785e01e1bb075743f2cefe',
    'modules/platform/telephony-extensions.js': '297c57844da78ced4079af610d0263d09ff0f191aa4303e272077ae3ebcc0b21',
    'modules/platform/telephony-queues.js': 'a13dbef126f18b21ab6e43c949c191d8b56a2c8537890c9c20f433d7c8b6b5d2',
}
NEW_FILES = (
    'modules/platform/category-aliases.js',
    MIGRATION,
)

SCHEMA_PROBE = r'''const db=require('/app/database/config').promise();(async()=>{
  const [columns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_telephony_calls' AND COLUMN_NAME IN ('lead_uid_hash','lead_id','remote_number') ORDER BY COLUMN_NAME");
  const [rows]=await db.query("SELECT migration_name,status,checksum,statements_completed,statement_count FROM salemax_schema_migrations WHERE migration_name=?",['20261112_telephony_call_remote_number.sql']);
  const [[table]]=await db.query("SELECT COUNT(*) AS tableCount FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_telephony_calls'");
  console.log(JSON.stringify({tableCount:Number(table.tableCount),columns:columns.map(row=>row.COLUMN_NAME),migration:rows[0]||null}));
  await db.end();
})().catch(error=>{console.error(error.code||'SCHEMA_PROBE_FAILED');process.exit(1)});'''


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed with status {result.returncode}')
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', PROJECT, '--project-directory', workdir]
    for name in env_files:
        args += ['--env-file', name]
    for name in files:
        args += ['-f', name]
    return args


def production_inventory():
    names = run('docker', 'ps', '-a', '--filter', f'label=com.docker.compose.project={PROJECT}', '--format', '{{.Names}}').splitlines()
    return {name: inspect(name)['Id'] for name in names}


def wait_healthy():
    for _ in range(45):
        current = inspect(APP)
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_production_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def safe_json_line(output):
    for line in reversed(output.splitlines()):
        if line.startswith('{'):
            return json.loads(line)
    raise RuntimeError('Production probe returned no structured result')


def schema_state():
    return safe_json_line(run('docker', 'exec', APP, 'node', '-e', SCHEMA_PROBE))


def expected_schema_before(state):
    columns = set(state['columns'])
    if state['tableCount'] != 1 or not {'lead_uid_hash', 'lead_id'}.issubset(columns):
        raise RuntimeError('Telephony call table or lead-link columns differ from reviewed schema')
    if state['migration'] is None and 'remote_number' not in columns:
        return 'pending'
    if ('remote_number' in columns and state['migration']
            and state['migration']['status'] == 'applied'
            and int(state['migration']['statements_completed']) == int(state['migration']['statement_count'])):
        return 'applied'
    raise RuntimeError('Telephony number migration/schema is in an unexpected state')


def verify_migration(state, migration_hash):
    row = state.get('migration')
    if ('remote_number' not in state.get('columns', []) or not row
            or row['status'] != 'applied'
            or row['checksum'] != migration_hash
            or int(row['statements_completed']) != 1
            or int(row['statement_count']) != 1):
        raise RuntimeError('Caller-number migration did not verify')


def app_compose_context(app):
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or files[-1] != ACTIVE_OVERLAY:
        raise RuntimeError('Active Call Center base overlay chain differs from reviewed baseline')
    if not env_files or not all(Path(path).is_file() for path in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return files, env_files, workdir


def protected_prior_compose_values(keys):
    candidates = {key: set() for key in keys}
    owner_uid = os.geteuid()
    for pattern in ('rollback-*/compose-vars.json', 'rollback-*/compose-manual-vars*.json'):
        for path in (ROOT / 'shared').glob(pattern):
            if path.is_symlink() or path.parent.is_symlink() or not path.is_file():
                continue
            try:
                file_stat, dir_stat = path.stat(), path.parent.stat()
                if (file_stat.st_uid != owner_uid or dir_stat.st_uid != owner_uid
                        or file_stat.st_mode & 0o077 or dir_stat.st_mode & 0o077):
                    continue
                data = json.loads(path.read_text())
            except (OSError, ValueError, TypeError):
                continue
            if not isinstance(data, dict):
                continue
            for key in keys:
                value = data.get(key)
                if isinstance(value, str) and value:
                    candidates[key].add(value)
    resolved = {}
    for key, values in candidates.items():
        if len(values) > 1:
            raise RuntimeError('Protected prior Compose snapshots disagree for: ' + key)
        if values:
            resolved[key] = next(iter(values))
    return resolved


def compose_environment(app, files, env_files, backup):
    supplied = {key for name in env_files for key in re.findall(
        r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    references = []
    for name in files:
        references.extend(re.findall(
            r'(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+?])[^}]*)?\}',
            Path(name).read_text()))
    live_env = dict(os.environ)
    live_env.update(dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item))
    variables = {}
    missing_required = set()
    for key, operator in references:
        if key in supplied:
            continue
        if key in live_env:
            variables[key] = live_env[key]
        elif operator not in ('-', ':-', '+', ':+'):
            missing_required.add(key)
    prior = protected_prior_compose_values(missing_required)
    if missing_required - set(prior):
        raise RuntimeError('Compose interpolation value is unavailable: ' + sorted(missing_required - set(prior))[0])
    variables.update(prior)
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    (backup / 'compose-vars.json').chmod(0o600)
    return dict(os.environ, **variables)


def verify_live_compose_app(app, config):
    service = config['services']['app']
    if service.get('image') != app['Config']['Image']:
        raise RuntimeError('Resolved Compose app image differs from the running app')
    expected = {row['target']: row for row in service.get('volumes', []) if row.get('type') == 'bind'}
    actual = {row['Destination']: row for row in app.get('Mounts', []) if row.get('Type') == 'bind'}
    if set(expected) != set(actual):
        raise RuntimeError('Resolved Compose bind mounts differ from the running app')
    for target, volume in expected.items():
        live = actual[target]
        if (os.path.realpath(volume.get('source', '')) != os.path.realpath(live.get('Source', ''))
                or bool(volume.get('read_only', False)) != (not bool(live.get('RW', True)))):
            raise RuntimeError('Resolved Compose bind mount differs from the running app: ' + target)


def validate_manifest(stage, commit):
    manifest = json.loads((stage / 'manifest.json').read_text())
    expected_files = set(RUNTIME_FILES) | {HELPER}
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != expected_files:
        raise RuntimeError('Stage manifest does not match the reviewed source commit')
    for name, expected in manifest['files'].items():
        source = stage / ('deploy' if name == HELPER else 'runtime') / name
        if source.is_symlink() or not source.is_file() or sha(source.read_bytes()) != expected:
            raise RuntimeError('Staged source hash mismatch')
    return manifest


def prepare_stage(source_root, stage, commit):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    source_root = Path(source_root).resolve()
    stage = Path(stage).resolve()
    if stage.exists() or stage == source_root or source_root in stage.parents:
        raise RuntimeError('Stage directory already exists or is inside the source checkout')
    if run('git', '-C', str(source_root), 'rev-parse', 'HEAD').strip() != commit:
        raise RuntimeError('Source checkout does not match requested commit')
    stage.mkdir(mode=0o700, parents=True)
    hashes = {}
    try:
        for name in RUNTIME_FILES:
            source = source_root / name
            target = stage / 'runtime' / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('Source file is missing or is a symlink')
            committed = subprocess.run(['git', '-C', str(source_root), 'show', f'{commit}:{name}'],
                capture_output=True, check=True).stdout
            data = source.read_bytes()
            if data != committed:
                raise RuntimeError('Runtime file differs from the committed source')
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
            hashes[name] = sha(data)
        helper_source = source_root / HELPER
        helper_target = stage / 'deploy' / HELPER
        committed_helper = subprocess.run(['git', '-C', str(source_root), 'show', f'{commit}:{HELPER}'],
            capture_output=True, check=True).stdout
        helper_data = helper_source.read_bytes()
        if helper_data != committed_helper:
            raise RuntimeError('Deployment helper differs from the committed source')
        helper_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        helper_target.write_bytes(helper_data)
        helper_target.chmod(0o755)
        hashes[HELPER] = sha(helper_data)
        (stage / 'manifest.json').write_text(json.dumps({'sourceCommit': commit, 'files': hashes}, indent=2) + '\n')
        (stage / 'manifest.json').chmod(0o600)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    print(json.dumps({'stage': str(stage), 'sourceCommit': commit, 'runtimeFiles': len(RUNTIME_FILES),
                      'deploymentHelperHash': hashes[HELPER]}))


def deploy(stage, commit):
    require_production_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage = Path(stage).resolve()
    manifest = validate_manifest(stage, commit)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    files, env_files, workdir = app_compose_context(app)
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    schema_before = schema_state()
    migration_action = expected_schema_before(schema_before)

    os.umask(0o077)
    release = ROOT / 'releases' / f'mobile-sip-call-center-{commit[:12]}-{RELEASE_DAY}'
    backup = ROOT / 'shared' / f'rollback-mobile-sip-call-center-{commit[:12]}-{RELEASE_DAY}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')

    # Validate live preimages before reserving fixed release/rollback paths so
    # a safe abort can be retried without leaving a misleading partial release.
    for name, expected in EXPECTED_PREIMAGES.items():
        target = '/app/' + name
        current_hash = run('docker', 'exec', APP, 'sha256sum', target).split()[0]
        if current_hash != expected:
            raise RuntimeError('Live file changed since source review: ' + name)
    for name in NEW_FILES:
        run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name)

    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes, indent=2) + '\n')
    (backup / 'schema-before.json').write_text(json.dumps(schema_before, indent=2) + '\n')
    (backup / 'stage-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (backup / 'container-inventory-before.json').write_text(json.dumps(production_inventory(), indent=2) + '\n')

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    changed = {}
    for name, expected in EXPECTED_PREIMAGES.items():
        target = '/app/' + name
        saved = backup / 'preimages' / name
        saved.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Protected preimage copy changed: ' + name)
    absent = []
    absent.extend(NEW_FILES)
    (backup / 'absent-paths.txt').write_text('\n'.join(absent) + '\n')

    for name in RUNTIME_FILES:
        data = (stage / 'runtime' / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in RUNTIME_FILES]
    overlay = release / 'compose.mobile-sip-call-center.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}) + '\n')
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    env = compose_environment(app, files, env_files, backup)
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    verify_live_compose_app(app, before)
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    old_app, new_app = before['services']['app'], after['services']['app']
    old_volumes = {row['target']: row for row in old_app.get('volumes', [])}
    new_volumes = {row['target']: row for row in new_app.get('volumes', [])}
    expected_targets = set(old_volumes) | {'/app/' + name for name in RUNTIME_FILES}
    if set(new_volumes) != expected_targets:
        raise RuntimeError('Candidate changes the app mount target set')
    for name in RUNTIME_FILES:
        volume = new_volumes.get('/app/' + name)
        if not volume or volume.get('type') != 'bind' or volume.get('source') != str(runtime / name) or volume.get('read_only') is not True:
            raise RuntimeError('Candidate mount differs from the reviewed source')
    before_without_volumes, after_without_volumes = copy.deepcopy(before), copy.deepcopy(after)
    before_without_volumes['services']['app'].pop('volumes', None)
    after_without_volumes['services']['app'].pop('volumes', None)
    if before_without_volumes != after_without_volumes:
        raise RuntimeError('Candidate changes non-mount Compose configuration')
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'overlay-path.txt').write_text(str(overlay) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    helper = release / HELPER
    helper.write_bytes((stage / 'deploy' / HELPER).read_bytes())
    helper.chmod(0o644)

    inventory_before = production_inventory()
    if inventory_before.get(APP) != app['Id']:
        raise RuntimeError('App container changed during release preparation')
    if inventory_before != json.loads((backup / 'container-inventory-before.json').read_text()):
        raise RuntimeError('Production container inventory changed during release preparation')
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Compose input changed during release preparation')
    for name, data in changed.items():
        if sha((stage / 'runtime' / name).read_bytes()) != sha(data):
            raise RuntimeError('Staged runtime source changed during release preparation')

    migration_hash = manifest['files'][MIGRATION]
    if migration_action == 'pending':
        # Install the additive migration into the current app container so its
        # existing validated runner can check the full applied history first.
        run('docker', 'cp', str(stage / 'runtime' / MIGRATION), f'{APP}:/app/{MIGRATION}')
        run('docker', 'exec', APP, 'node', '/app/database/migrate-pipeline.js', '--apply', '--only', Path(MIGRATION).name)
    verify_migration(schema_state(), migration_hash)
    (backup / 'schema-after.json').write_text(json.dumps(schema_state(), indent=2) + '\n')

    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        inventory_after = production_inventory()
        if {name: identity for name, identity in inventory_after.items() if name != APP} != {
                name: identity for name, identity in inventory_before.items() if name != APP}:
            raise RuntimeError('A non-app production container changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        verify_migration(schema_state(), migration_hash)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'appMounts': len(current['Mounts']),
                  'runtimeFiles': len(changed), 'migration': MIGRATION,
                  'migrationAction': migration_action, 'migrationChecksum': migration_hash,
                  'hashes': {name: sha(data) for name, data in changed.items()},
                  'unchangedNonAppContainers': len(inventory_after) - (1 if APP in inventory_after else 0)}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_production_lock()
    backup = Path(backup).resolve()
    app = inspect(APP)
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    input_hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(not Path(name).is_file() or sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('A prior Compose or environment input changed; refusing an unreviewed rollback')
    workdir = (backup / 'compose-working-dir.txt').read_text().strip()
    overlay = (backup / 'overlay-path.txt').read_text().strip()
    if app['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [overlay]):
        raise RuntimeError('A later app overlay is active; restore overlays in reverse order')
    prior_inventory = json.loads((backup / 'container-inventory-before.json').read_text())
    current_inventory = production_inventory()
    expected_support = {name: identity for name, identity in prior_inventory.items() if name != APP}
    if {name: identity for name, identity in current_inventory.items() if name != APP} != expected_support:
        raise RuntimeError('A non-app production container changed since this release')
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, workdir)
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    if current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files):
        raise RuntimeError('Prior app Compose chain did not restore')
    if {name: identity for name, identity in production_inventory().items() if name != APP} != expected_support:
        raise RuntimeError('A non-app production container changed during restore')
    print(json.dumps({'restoredComposeInputs': len(files), 'appImage': current['Image'],
                      'migrationRetained': (backup / 'schema-after.json').is_file()}))


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage-path> <commit> | restore <rollback-path>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(1)
