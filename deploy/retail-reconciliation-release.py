#!/usr/bin/env python3
"""Release the reviewed Retail app overlay and its eight forward migrations."""
import base64
import gzip
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

OPS_FILE = 'pro-catalyst-center-visit-signal-release.py'
MIGRATOR_FILE = 'retail-reconciliation-migrate.cjs'
OVERLAY_FILE = 'compose.retail-reconciliation.json'
PILOT_ENV = 'SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS'
ORIGIN = 'https://7network.live'

spec = importlib.util.spec_from_file_location('compose_release', Path(__file__).with_name(OPS_FILE))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


def emit(phase, **values):
    print(json.dumps({'phase': phase, **values}), flush=True)


def file_sha(path):
    return ops.sha(Path(path).read_bytes())


def healthy(container):
    return container['State'].get('Health', {}).get('Status') == 'healthy'


def run_migrator(command, request):
    result = subprocess.run(command, input=json.dumps(request), capture_output=True, text=True, timeout=300)
    if result.returncode:
        # The migration actor writes only safe error codes and migration checkpoint metadata.
        for line in result.stderr.splitlines():
            try:
                evidence = json.loads(line)
            except ValueError:
                continue
            if set(evidence) in ({'code'}, {'selected'}):
                emit('migration_error', **evidence)
        raise RuntimeError('Retail migration actor failed')
    return json.loads(result.stdout.splitlines()[-1])


def migrate(app, migrator, request, mode):
    return run_migrator(['docker', 'exec', '-i', app, 'node', '-e', migrator, mode], request)


def dump_command(db, protected):
    options = ('--protocol=socket --user=root --single-transaction --skip-lock-tables '
               '--quick --order-by-primary --skip-extended-insert --skip-comments --routines --events --triggers --hex-blob')
    if protected:
        script = ('export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; '
                  'test -n "$MYSQL_PWD" && test -n "$MARIADB_DATABASE"; '
                  f'exec mariadb-dump {options} --databases "$MARIADB_DATABASE"')
    else:
        script = ('set -- $(mariadb -uroot -Nse "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA '
                  "WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')\"); "
                  'test "$#" -eq 1; '
                  f'exec mariadb-dump {options} --databases "$1"')
    return ['docker', 'exec', db, 'sh', '-euc', script]


def dump(db, target, protected):
    with subprocess.Popen(dump_command(db, protected), stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as process:
        with gzip.open(target, 'wb', compresslevel=3) as output:
            shutil.copyfileobj(process.stdout, output)
        if process.wait(timeout=60):
            raise RuntimeError('MariaDB logical backup failed')


def dump_fingerprint(filename):
    import hashlib
    digest = hashlib.sha256()
    tables, inserts = 0, 0
    with gzip.open(filename, 'rb') as backup:
        for line in backup:
            if line.startswith((b'CREATE TABLE ', b'INSERT INTO ')):
                digest.update(line)
                tables += line.startswith(b'CREATE TABLE ')
                inserts += line.startswith(b'INSERT INTO ')
    if not tables or not inserts:
        raise RuntimeError('Logical backup appears incomplete')
    return {'tables': tables, 'insertStatements': inserts, 'fingerprint': digest.hexdigest()}


def wait_restore_database(container):
    for _ in range(40):
        result = subprocess.run(
            ['docker', 'exec', container, 'mariadb', '-uroot', '-Nse',
             'SELECT @@skip_networking,@@event_scheduler'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip() == '0\tOFF':
            return
        time.sleep(1)
    raise RuntimeError('Isolated MariaDB did not start')


def restore_and_rehearse(db_image, app_image, backup, migrator, request):
    archive = backup / 'database.sql.gz'
    fingerprint = dump_fingerprint(archive)
    container = ops.run(
        'docker', 'run', '-d', '--rm', '--network', 'none', '--cpus', '1', '--memory', '1g',
        '--pids-limit', '256', '--label', 'com.7network.purpose=retail-restore-rehearsal',
        '--env', 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1', db_image, '--bind-address=127.0.0.1',
        '--event-scheduler=OFF', '--skip-log-bin', '--innodb-buffer-pool-size=128M',
        '--innodb-flush-log-at-trx-commit=2'
    ).strip()
    try:
        isolation = ops.inspect(container)['HostConfig']
        if isolation['NetworkMode'] != 'none' or isolation.get('PortBindings'):
            raise RuntimeError('Restore database must be network-isolated')
        wait_restore_database(container)
        with gzip.open(archive, 'rb') as source, subprocess.Popen(
            ['docker', 'exec', '-i', container, 'mariadb', '-uroot'],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        ) as process:
            shutil.copyfileobj(source, process.stdin)
            process.stdin.close()
            if process.wait(timeout=90):
                raise RuntimeError('Logical backup restore failed')
        restored_archive = backup / 'restore-verification.sql.gz'
        try:
            dump(container, restored_archive, protected=False)
            if dump_fingerprint(restored_archive) != fingerprint:
                raise RuntimeError('Restored table and row-insert fingerprints differ')
        finally:
            restored_archive.unlink(missing_ok=True)
        emit('backup_restored', tables=fingerprint['tables'], archiveBytes=archive.stat().st_size)
        rehearsal = run_migrator([
            'docker', 'run', '--rm', '-i', '--network', f'container:{container}', '--memory', '512m',
            '--user', '0:0', '--cap-drop', 'ALL', '--workdir', '/app',
            '--env', 'RETAIL_RESTORE_ONLY=1', '--mount', f'type=bind,src={backup / "baseline"},dst=/retail-baseline,ro',
            '--entrypoint', 'node', app_image, '-e', migrator, 'rehearse'
        ], request)
        return {'backupSha256': file_sha(archive), **fingerprint, 'migrationRehearsal': rehearsal}
    finally:
        ops.run('docker', 'rm', '-f', '-v', container)


def status(path):
    request = Request(ORIGIN + path, headers={'Accept-Encoding': 'identity'})
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, response.read(4 * 1024**2)
    except HTTPError as error:
        return error.code, b''


def public_checks(hashes):
    expected = {
        '/healthz': 200,
        '/user/login': 200,
        '/admin/login': 200,
        '/user?page=retail-orders': 200,
        '/api/workspace/retail/orders/overview': 401,
        '/api/workspace/retail/orders/online': 401,
        '/api/workspace/retail/connectors': 401,
        '/api/workspace/business-inventory/locations': 401,
    }
    actual = {path: status(path)[0] for path in expected}
    if actual != expected:
        raise RuntimeError('Public Retail health or anonymous-access checks differ')
    for asset in ('retail-workspace.js', 'business-inventory.js', 'training-sidebar.js'):
        code, data = status('/' + asset + '?v=20261124-retail-reconciliation')
        if code != 200 or ops.sha(data) != hashes['client/public/' + asset]:
            raise RuntimeError('Public Retail asset differs: ' + asset)
    return actual


def stage_manifest(stage, commit):
    info = json.loads((stage / 'manifest.json').read_text())
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or info['commit'] != commit:
        raise RuntimeError('Unexpected Git source commit')
    if set(info['preimages']) != set(info['runtime']):
        raise RuntimeError('Incomplete live Retail preimage manifest')
    for path, checksum in {**info['runtime'], **info['tools']}.items():
        if path != 'database/migration-runner.js' and not re.fullmatch(
                r'(?:modules/platform|client/public|database/migrations|deploy|'
                r'integrations/woocommerce/7network-retail-connector)/[A-Za-z0-9._-]+', path):
            raise RuntimeError('Unexpected Retail release path')
        source = stage / path
        if source.is_symlink() or not source.is_file() or file_sha(source) != checksum:
            raise RuntimeError('Staged Retail source hash differs: ' + path)
    return info


def check_preimages(stage, release, backup, info):
    mounts = []
    for relative, checksum in sorted(info['runtime'].items()):
        destination = '/app/' + relative
        prior = info['preimages'][relative]
        if prior is None:
            ops.run('docker', 'exec', ops.APP, 'test', '!', '-e', destination)
        else:
            saved = backup / 'preimages' / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            ops.run('docker', 'cp', f'{ops.APP}:{destination}', str(saved))
            if file_sha(saved) != prior:
                raise RuntimeError('Live Retail file changed: ' + relative)
            saved.chmod(0o600)
        target = release / 'runtime' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(stage / relative, target)
        target.chmod(0o644)
        mounts.append({'type': 'bind', 'source': str(target), 'target': destination,
                       'read_only': True, 'bind': {'create_host_path': False}})
    return mounts


def pending_migration_payload(info, stage):
    artifacts = {**info['runtime'], **info['tools']}
    payload = {}
    for relative in info['pending']:
        if relative not in artifacts:
            raise RuntimeError('Pending migration is missing from staged artifacts')
        payload[Path(relative).name] = {
            'sha256': artifacts[relative],
            'source': base64.b64encode((stage / relative).read_bytes()).decode('ascii'),
        }
    return payload


def guard_rollback(app_id, support, input_hashes):
    if ops.inspect(ops.APP)['Id'] != app_id or any(file_sha(name) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Active app or Compose inputs changed during Retail preparation')
    if {k: v for k, v in ops.inventory().items() if k != ops.APP} != support:
        raise RuntimeError('Support service identity changed')


def rollback_app(common, environment, image):
    # Query the still-running database directly if the candidate app failed to boot.
    adoption = (
        'SELECT (SELECT COUNT(*) FROM sx_retail_product_inventory_units) + '
        '(SELECT COUNT(*) FROM sx_retail_inventory_unit_rebases) + '
        '(SELECT COUNT(*) FROM sx_retail_external_product_mappings) + '
        '(SELECT COUNT(*) FROM sx_retail_external_product_variants) + '
        '(SELECT COUNT(*) FROM sx_business_stock_movements WHERE unit_rebase_id IS NOT NULL '
        'OR quantity<>FLOOR(quantity) OR previous_quantity<>FLOOR(previous_quantity))'
    )
    sql = ('export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; '
           'exec mariadb --protocol=socket -uroot -N "$MARIADB_DATABASE" -e "$1"')
    if ops.run('docker', 'exec', ops.DB, 'sh', '-euc', sql, 'retail-rollback', adoption).strip() != '0':
        raise RuntimeError('Adopted Retail unit or connector data requires a compatible forward repair')
    ops.run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=environment)
    if ops.wait_healthy()['Image'] != image:
        raise RuntimeError('Restored application image differs')


def deploy(stage, commit):
    ops.require_lock()
    os.umask(0o077)
    stage = Path(stage).resolve()
    info = stage_manifest(stage, commit)
    migrator = (stage / 'deploy' / MIGRATOR_FILE).read_text()
    app, db = ops.inspect(ops.APP), ops.inspect(ops.DB)
    if not (healthy(app) and healthy(db) and app['Image'] == info['image']):
        raise RuntimeError('Current app/database or verified runtime image changed')
    if any(item.startswith(PILOT_ENV + '=') and item.partition('=')[2].strip()
           for item in app['Config'].get('Env', [])):
        raise RuntimeError('Active pilot configuration requires separate connector readiness verification')
    if shutil.disk_usage(ops.ROOT).free < ops.MINIMUM_FREE_BYTES:
        raise RuntimeError('Insufficient free space for a protected restore rehearsal')
    files, env_files, workdir = ops.compose_context(app)
    if info.get('lastOverlay') not in files:
        raise RuntimeError('Reviewed production baseline overlay is no longer active')
    environment, _ = ops.compose_environment(app, files, env_files)
    common = ops.compose_args(files, env_files, workdir)
    before = json.loads(ops.run(*common, 'config', '--format', 'json', env=environment))
    ops.verify_live_compose_app(app, before)
    if ops.run('docker', 'image', 'inspect', '--format', '{{.Id}}', app['Config']['Image']).strip() != app['Image']:
        raise RuntimeError('The named app image has moved')
    support = {k: v for k, v in ops.inventory().items() if k != ops.APP}
    input_hashes = {name: file_sha(name) for name in files + env_files}

    suffix = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release_name = info.get('releaseName', 'retail-reconciliation')
    if not re.fullmatch(r'[a-z0-9-]{3,80}', release_name):
        raise RuntimeError('Unexpected Retail release name')
    name = f'{release_name}-{commit[:12]}-{suffix}'
    release = ops.ROOT / 'releases' / name
    backup = ops.ROOT / 'shared' / ('rollback-' + name)
    release.mkdir(mode=0o700)
    backup.mkdir(mode=0o700)
    emit('protected_backup_started', rollback=str(backup))
    mounts = check_preimages(stage, release, backup, info)
    overlay = release / OVERLAY_FILE
    ops.write_private(overlay, {'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}})
    candidate = common + ['-f', str(overlay)]
    after = json.loads(ops.run(*candidate, 'config', '--format', 'json', env=environment))
    ops.validate_candidate(before, after, mounts)
    for relative in info['tools']:
        target = release / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(stage / relative, target)
    ops.write_private(backup / 'state.json', {
        'commit': commit, 'release': str(release), 'image': app['Image'], 'appBefore': app['Id'],
        'dbBefore': db['Id'], 'files': files, 'envFiles': env_files, 'workdir': workdir,
        'inputHashes': input_hashes, 'support': support, 'manifest': info,
    })

    history = backup / 'baseline'
    history.mkdir(mode=0o700)
    for item in ('migrations', 'migration-runner.js'):
        ops.run('docker', 'cp', f'{ops.APP}:/app/database/{item}', str(history / item))
    pending = pending_migration_payload(info, stage)
    request = {'migrations': pending}
    ops.write_private(backup / 'migrations.json', request)

    dump(db['Id'], backup / 'database.sql.gz', protected=True)
    proof = restore_and_rehearse(db['Image'], app['Image'], backup, migrator, request)
    request['baseline'] = proof['migrationRehearsal']['baseline']
    ops.write_private(backup / 'migrations.json', request)
    ops.write_private(backup / 'restore-proof.json', proof)
    emit('migration_rehearsal_passed', migrations=len(pending), startingLedger=request['baseline']['total'])

    guard_rollback(app['Id'], support, input_hashes)
    migrated = migrate(ops.APP, migrator, request, 'apply')
    ops.write_private(backup / 'migration-result.json', migrated)
    emit('production_migrations_applied', migrations=migrated['applied'], total=migrated['total'])

    try:
        ops.run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=environment)
        current = ops.wait_healthy()
        if current['Image'] != app['Image'] or current['RestartCount'] != 0:
            raise RuntimeError('Retail overlay app image or restart count differs')
        if ops.compose_context(current)[0] != files + [str(overlay)]:
            raise RuntimeError('Unexpected active Retail Compose chain')
        guard_rollback(current['Id'], support, input_hashes)
        ops.verify_live_compose_app(current, after)
        if not healthy(ops.inspect(ops.DB)):
            raise RuntimeError('Database health changed')
        for relative, digest in info['runtime'].items():
            if ops.run('docker', 'exec', ops.APP, 'sha256sum', '/app/' + relative).split()[0] != digest:
                raise RuntimeError('Retail runtime asset differs: ' + relative)
        verified = migrate(ops.APP, migrator, request, 'verify')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': app['Image'], 'composeInputs': len(files) + 1, 'mounts': len(current['Mounts']),
                  'database': verified, 'public': public_checks({**info['runtime'], **info['publicAssets']}), 'backup': proof}
        ops.write_private(backup / 'result.json', result)
        emit('verified', **result)
    except Exception:
        try:
            prior_is_running = ops.inspect(ops.APP)['Id'] == app['Id']
        except RuntimeError:
            prior_is_running = False
        if not prior_is_running:
            rollback_app(common, environment, app['Image'])
            emit('app_rolled_back', rollback=str(backup))
        raise


def restore(backup):
    ops.require_lock()
    backup = Path(backup).resolve()
    if backup.parent != ops.ROOT / 'shared' or not backup.name.startswith('rollback-'):
        raise RuntimeError('Unexpected Retail rollback path')
    state = json.loads((backup / 'state.json').read_text())
    release = Path(state['release'])
    if backup.name != 'rollback-' + release.name or release.parent != ops.ROOT / 'releases':
        raise RuntimeError('Retail rollback snapshot does not match its release')
    app = ops.inspect(ops.APP)
    files, env_files, workdir = ops.compose_context(app)
    if files != state['files'] + [str(release / OVERLAY_FILE)]:
        raise RuntimeError('A later app overlay is active')
    guard_rollback(app['Id'], state['support'], state['inputHashes'])
    environment, _ = ops.compose_environment(app, state['files'], env_files)
    common = ops.compose_args(state['files'], env_files, workdir)
    rollback_app(common, environment, state['image'])
    emit('app_rolled_back', rollback=str(backup))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(sys.argv[2])
    else:
        raise SystemExit('Usage: retail-reconciliation-release.py deploy STAGE COMMIT | restore BACKUP')
