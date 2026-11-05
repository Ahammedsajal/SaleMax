"""Apply the private inventory overlay to the verified 7Network production chain."""
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

APP = 'salemax-app-1'
MIGRATION = '20270125_private_business_inventory.sql'
PRIOR = Path('/opt/salemax/shared/rollback-lead-chat-deep-link-31bee0f6-20261105')
EXPECTED_BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def status(path):
    try:
        with urllib.request.urlopen('https://7network.live' + path, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as response:
        return response.code, b''


def main(stage, commit):
    if os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1' or os.geteuid() != 0:
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01' or os.path.realpath('/opt/salemax/current') != EXPECTED_BASE:
        raise RuntimeError('Production host or base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid commit')
    os.umask(0o077)
    prior_files = (PRIOR / 'compose-files.after.txt').read_text().splitlines()
    env_files = (PRIOR / 'compose-env-files.after.txt').read_text().splitlines()
    app = inspect(APP)
    labels = app['Config']['Labels']
    if labels['com.docker.compose.project.config_files'] != ','.join(prior_files):
        raise RuntimeError('Active Compose chain differs from the reviewed release')
    if app['State']['Health']['Status'] != 'healthy':
        raise RuntimeError('Current app is unhealthy')

    release = Path('/opt/salemax/releases/private-inventory-' + commit[:12])
    backup = Path('/opt/salemax/shared/rollback-private-inventory-' + commit[:12])
    backup.mkdir(mode=0o700)
    release.mkdir(mode=0o755)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    (backup / 'before.json').write_text(json.dumps(app))
    (backup / 'source-commit.txt').write_text(commit + '\n')
    for name in ('compose-env-files.after.txt', 'compose-files.after.txt', 'compose-manual-vars.json', 'compose-working-dir.before.txt'):
        shutil.copyfile(PRIOR / name, backup / name)
    inputs = {name: checksum(Path(name).read_bytes()) for name in prior_files + env_files}
    (backup / 'compose-input-checksums.json').write_text(json.dumps(inputs))

    mounts = []
    for line in (stage / 'manifest.txt').read_text().splitlines():
        expected, name = line.split()
        source = stage / name
        target = '/app/' + name
        if expected != 'new':
            actual = run('docker', 'exec', APP, 'sha256sum', target).split()[0]
            if actual != expected:
                raise RuntimeError('Production source diverged: ' + name)
            saved = backup / 'preimages' / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            run('docker', 'cp', APP + ':' + target, str(saved))
        else:
            exists = subprocess.run(['docker', 'exec', APP, 'test', '-e', target], capture_output=True)
            if exists.returncode != 1:
                raise RuntimeError('Expected absent source: ' + name)
        path = runtime / name
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        shutil.copyfile(source, path)
        path.chmod(0o644)
        mounts.append({'type': 'bind', 'source': str(path), 'target': target, 'read_only': True, 'bind': {'create_host_path': False}})

    overlay = release / 'compose.inventory.json'
    overlay.write_text(json.dumps({'services': {'app': {'volumes': mounts}}}))
    env = os.environ.copy()
    manual = json.loads((PRIOR / 'compose-manual-vars.json').read_text())
    supplied = {match for name in env_files for match in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {match for name in prior_files for match in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    overrides = {}
    for key in referenced - supplied:
        if key in manual:
            overrides[key] = manual[key]
        elif key in live_env:
            overrides[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose variable: ' + key)
    env.update(overrides)
    workdir = (PRIOR / 'compose-working-dir.before.txt').read_text().strip()
    common = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for path in env_files:
        common.extend(['--env-file', path])
    for path in prior_files:
        common.extend(['-f', path])
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    before_app, after_app = before['services'].pop('app'), after['services'].pop('app')
    expected_mounts = {row['target']: row for row in before_app.pop('volumes')}
    expected_mounts.update({row['target']: row for row in mounts})
    actual_mounts = {row['target']: row for row in after_app.pop('volumes')}
    restore = backup / 'restore.py'
    restore.write_text(
        'import json, os, subprocess\n'
        + 'assert os.environ.get("SALEMAX_DEPLOY_LOCK_HELD") == "1"\n'
        + 'assert os.path.realpath("/opt/salemax/current") == ' + repr(EXPECTED_BASE) + '\n'
        + 'app = json.loads(subprocess.check_output(["docker", "inspect", "salemax-app-1"]))[0]\n'
        + 'assert app["Config"]["Labels"]["com.docker.compose.project.config_files"] == ' + repr(','.join(prior_files + [str(overlay)])) + '\n'
        + 'env = dict(os.environ, **' + repr(overrides) + ')\n'
        + 'subprocess.run(' + repr(common + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']) + ', env=env, check=True)\n'
    )
    def mount_identity(row):
        return row['type'], row.get('source'), row['target'], row.get('read_only', False)

    old_mounts = {row['target']: row for row in json.loads(run(*common, 'config', '--format', 'json', env=env))['services']['app']['volumes']}
    replacements = {row['target'] for row in mounts}
    config_keys = [key for key in before.keys() | after.keys() if before.get(key) != after.get(key)]
    app_keys = [key for key in before_app.keys() | after_app.keys() if before_app.get(key) != after_app.get(key)]
    different = [target for target in expected_mounts.keys() | actual_mounts.keys()
                 if target not in expected_mounts or target not in actual_mounts
                 or mount_identity(expected_mounts[target]) != mount_identity(actual_mounts[target])
                 or (target not in replacements and actual_mounts[target] != old_mounts[target])]
    if config_keys or app_keys or different:
        raise RuntimeError(f'Unexpected Compose changes: config keys {config_keys}, app keys {app_keys}, targets {different}')
    services = {name: inspect(name)['Id'] for name in (
        'salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
        'salemax-recruitment-founder-notification-worker-1')}
    (backup / 'support-services.json').write_text(json.dumps(services))

    for row in mounts:
        if row['target'].endswith('.js'):
            run('docker', 'run', '--rm', '--network', 'none', '-v',
                row['source'] + ':/verify.js:ro', '--entrypoint', 'node', app['Image'], '--check', '/verify.js')
    if any(checksum(Path(name).read_bytes()) != digest for name, digest in inputs.items()):
        raise RuntimeError('Compose input changed after preparation')
    if inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running application changed after preparation')

    database_env = backup / 'database.env'
    keys = {'DBHOST', 'DBPORT', 'DBUSER', 'DBPASS', 'DBNAME'}
    values = [item for item in app['Config']['Env'] if item.split('=', 1)[0] in keys]
    if not {'DBHOST', 'DBUSER', 'DBNAME'}.issubset(item.split('=', 1)[0] for item in values):
        raise RuntimeError('Database connection configuration is incomplete')
    if any('\n' in item or '\r' in item for item in values):
        raise RuntimeError('Invalid database connection configuration')
    database_env.write_text('\n'.join(values) + '\n')
    try:
        output = run('docker', 'run', '--rm', '--network', 'container:' + APP, '--env-file',
                     str(database_env), '-v', str(runtime / 'database/migrations' / MIGRATION) +
                     ':/app/database/migrations/' + MIGRATION + ':ro', '--entrypoint',
                     'node', app['Image'], '/app/database/migrate-pipeline.js', '--apply', '--only', MIGRATION)
        (backup / 'migration-result.json').write_text(output)
    finally:
        database_env.unlink(missing_ok=True)

    def wait_healthy():
        for _ in range(40):
            current = inspect(APP)
            if current['State'].get('Health', {}).get('Status') == 'healthy':
                return current
            time.sleep(2)
        raise RuntimeError('App health did not recover')

    command = ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app']
    try:
        run(*candidate, *command, env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or any(inspect(name)['Id'] != value for name, value in services.items()):
            raise RuntimeError('Running app image or support service changed unexpectedly')
        for row in mounts:
            actual = run('docker', 'exec', APP, 'sha256sum', row['target']).split()[0]
            if actual != checksum(Path(row['source']).read_bytes()):
                raise RuntimeError('A running file does not match the release')
        if status('/healthz')[0] != 200 or status('/api/workspace/business-inventory')[0] not in (401, 403):
            raise RuntimeError('Health or anonymous inventory denial failed')
        code, body = status('/user?page=business-inventory')
        if code != 200 or b'/business-inventory.js?v=1' not in body:
            raise RuntimeError('Business shell does not serve Inventory')
        result = {'release': str(release), 'backup': str(backup), 'image': current['Image'],
                  'commit': commit, 'migration': MIGRATION, 'anonymousInventoryDenied': True}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, *command, env=env)
        wait_healthy()
        raise


if __name__ == '__main__':
    main(Path(sys.argv[1]), sys.argv[2])
