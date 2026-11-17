#!/usr/bin/env python3
"""Deploy or roll back the exact-preimage WooCommerce connection fix."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time


ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
DB = 'salemax-db-1'
BASE_RELEASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
BASE_HELPER = Path('/opt/salemax/releases/retail-connected-stores-c150cb13c196-20261116/deploy/retail-connected-stores-release.py')
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
EXPECTED_LIVE_ROUTER_SHA = '962268f47f12a3dec46da80e5a20cd7e152f4aef7e4b22ce47737fec6e6cc8c6'
EXPECTED_PATCHED_ROUTER_SHA = 'cd4c870af2b689c3d1d1f8d273bbc8a5f32e848b66588732e7d0e9c13e66dc2b'
TARGET = 'modules/platform/retail-connected-stores-router.js'
OLD_RETURN = b'  return connection;\n'
NEW_RETURN = b'  return true;\n'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare_live_router(source, expected_sha=EXPECTED_LIVE_ROUTER_SHA,
                        expected_output_sha=EXPECTED_PATCHED_ROUTER_SHA):
    if sha(source) != expected_sha:
        raise RuntimeError('Live WooCommerce router preimage changed')
    if source.count(OLD_RETURN) != 1:
        raise RuntimeError('Expected one undefined connection return')
    updated = source.replace(OLD_RETURN, NEW_RETURN, 1)
    if sha(updated) != expected_output_sha:
        raise RuntimeError('Patched WooCommerce router differs from the reviewed artifact')
    return updated


def base_helper():
    if not BASE_HELPER.is_file():
        raise RuntimeError('Reviewed Connected Stores release helper is missing')
    spec = importlib.util.spec_from_file_location('retail_connected_stores_base_release', BASE_HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_app_snapshot(app):
    labels = app.get('Config', {}).get('Labels', {}) or {}
    return {
        'containerId': app.get('Id'),
        'imageId': app.get('Image'),
        'imageName': app.get('Config', {}).get('Image'),
        'state': app.get('State', {}).get('Status'),
        'health': app.get('State', {}).get('Health', {}).get('Status'),
        'composeFiles': labels.get('com.docker.compose.project.config_files', ''),
        'composeWorkingDir': labels.get('com.docker.compose.project.working_dir', ''),
        'mounts': [{'source': row.get('Source'), 'target': row.get('Destination'),
                    'readOnly': row.get('RW') is False} for row in app.get('Mounts', [])],
    }


def write_private_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')
    path.chmod(0o600)


def read_lines(path):
    return [line for line in path.read_text().splitlines() if line]


def compose_candidate(base, app, meta, env, router_path, overlay_path):
    mounts = [{'type': 'bind', 'source': str(router_path), 'target': '/app/' + TARGET,
               'read_only': True, 'bind': {'create_host_path': False}}]
    overlay_path.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay_path.chmod(0o644)
    common = base.compose_args(meta['files'], meta['env_files'], meta['workdir'])
    candidate = common + ['-f', str(overlay_path)]
    before = json.loads(base.run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(base.run(*candidate, 'config', '--format', 'json', env=env))
    expected_volumes = {row['target']: row for row in before['services']['app'].get('volumes', [])}
    actual_volumes = {row['target']: row for row in after['services']['app'].get('volumes', [])}
    for mount in mounts:
        target = mount['target']
        actual = actual_volumes.pop(target, {})
        expected_volumes.pop(target, None)
        if any(actual.get(key) != mount[key] for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate did not replace the reviewed router mount')
    if actual_volumes != expected_volumes:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app, after_app = dict(before['services']['app']), dict(after['services']['app'])
    before_app.pop('volumes', None)
    after_app.pop('volumes', None)
    if before_app != after_app:
        raise RuntimeError('Candidate changes non-mount app configuration')
    if {key: value for key, value in before['services'].items() if key != 'app'} != \
            {key: value for key, value in after['services'].items() if key != 'app'}:
        raise RuntimeError('Candidate changes another Compose service')
    return common, candidate


def preflight():
    base = base_helper()
    base.require_lock()
    app = base.inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('App health or image differs from the reviewed baseline')
    db = base.inspect(DB)
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if shutil.disk_usage(ROOT).free < 2 * 1024**3:
        raise RuntimeError('Insufficient free space for guarded release')
    meta = base.compose_meta(app)
    if not any('retail-connected-stores-c150cb13c196-20261116' in path for path in meta['files']):
        raise RuntimeError('Active Compose chain does not include the reviewed Retail screen overlay')
    env, _ = base.compose_environment(app, meta)
    with tempfile.TemporaryDirectory(prefix='retail-woo-connect-preflight-') as temporary:
        folder = Path(temporary)
        router = folder / 'retail-connected-stores-router.js'
        live = base.run('docker', 'exec', APP, 'cat', '/app/' + TARGET).encode()
        updated = prepare_live_router(live)
        router.write_bytes(updated)
        overlay = folder / 'compose.retail-woo-connect-fix.json'
        compose_candidate(base, app, meta, env, router, overlay)
    print(json.dumps({'status': 'preflight-ok', 'appImage': app['Config']['Image'],
                      'liveRouterSha256': EXPECTED_LIVE_ROUTER_SHA,
                      'patchedRouterSha256': EXPECTED_PATCHED_ROUTER_SHA}))


def deploy(commit):
    base = base_helper()
    base.require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    app = base.inspect(APP)
    db = base.inspect(DB)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('App health or image differs from the reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy')
    if base.inspect('salemax-report-worker-1')['State'].get('Status') != 'running':
        raise RuntimeError('Report worker is not running')
    if shutil.disk_usage(ROOT).free < 2 * 1024**3:
        raise RuntimeError('Insufficient free space for guarded release')

    meta = base.compose_meta(app)
    if not any('retail-connected-stores-c150cb13c196-20261116' in path for path in meta['files']):
        raise RuntimeError('Active Compose chain does not include the reviewed Retail screen overlay')
    env, _ = base.compose_environment(app, meta)
    original = base.run('docker', 'exec', APP, 'cat', '/app/' + TARGET).encode()
    if sha(original) != EXPECTED_LIVE_ROUTER_SHA or \
            base.run('docker', 'exec', APP, 'sha256sum', '/app/' + TARGET).split()[0] != EXPECTED_LIVE_ROUTER_SHA:
        raise RuntimeError('Live router preimage differs from the reviewed production source')
    updated = prepare_live_router(original)
    with tempfile.TemporaryDirectory(prefix='retail-woo-connect-candidate-') as temporary:
        folder = Path(temporary)
        candidate_router = folder / 'retail-connected-stores-router.js'
        candidate_router.write_bytes(updated)
        candidate_overlay = folder / 'compose.retail-woo-connect-fix.json'
        common, _ = compose_candidate(base, app, meta, env, candidate_router, candidate_overlay)
    date = time.strftime('%Y%m%d', time.gmtime())
    release = ROOT / 'releases' / f'retail-woo-connect-fix-{commit[:12]}-{date}'
    backup = ROOT / 'shared' / f'rollback-retail-woo-connect-fix-{commit[:12]}-{date}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')

    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    write_private_json(backup / 'app-before.json', safe_app_snapshot(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(meta['files']) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(meta['env_files']) + '\n')
    (backup / 'compose-working-dir.txt').write_text(meta['workdir'] + '\n')
    hashes = {path: sha(Path(path).read_bytes()) for path in meta['files'] + meta['env_files']}
    write_private_json(backup / 'compose-input-hashes.json', hashes)
    support_ids = {name: base.inspect(name)['Id'] for name in base.SUPPORT}
    write_private_json(backup / 'support-service-ids.json', support_ids)

    preimage = backup / 'preimages' / TARGET
    preimage.parent.mkdir(parents=True, mode=0o700)
    preimage.write_bytes(original)
    preimage.chmod(0o600)
    if sha(preimage.read_bytes()) != EXPECTED_LIVE_ROUTER_SHA:
        raise RuntimeError('Protected rollback router preimage failed its checksum')
    router_path = release / 'runtime' / TARGET
    router_path.parent.mkdir(parents=True, mode=0o755)
    router_path.write_bytes(updated)
    router_path.chmod(0o644)
    overlay_path = release / 'compose.retail-woo-connect-fix.json'
    common, candidate = compose_candidate(base, app, meta, env, router_path, overlay_path)
    overlay_path_text = str(overlay_path)
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (backup / 'overlay-path.txt').write_text(overlay_path_text + '\n')
    write_private_json(backup / 'router-preimage-hash.json', {'path': TARGET, 'sha256': sha(original)})
    write_private_json(release / 'manifest.json', {
        'sourceCommit': commit,
        'baseImage': app['Config']['Image'],
        'runtimeFile': TARGET,
        'preimageSha256': sha(original),
        'runtimeSha256': sha(updated),
        'databaseChanged': False,
        'servicesRecreated': ['app'],
    })
    release_helper = release / 'deploy' / 'retail-woocommerce-connect-fix-release.py'
    release_helper.parent.mkdir(mode=0o755)
    release_helper.write_bytes(Path(__file__).read_bytes())
    release_helper.chmod(0o644)
    (backup / 'rollback-instructions.txt').write_text(
        f'sudo -n /opt/salemax/shared/with-production-lock.sh python3 {release_helper} restore {backup}\n')

    input_hashes_before = hashes
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes_before.items()) or \
            base.inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    try:
        base.run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = base.wait_healthy()
        labels = current['Config'].get('Labels', {})
        expected_files = ','.join(meta['files'] + [overlay_path_text])
        if current['Image'] != app['Image'] or labels.get('com.docker.compose.project.config_files') != expected_files:
            raise RuntimeError('App image or Compose chain changed after activation')
        if base.inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Database health changed during release')
        if any(base.inspect(name)['Id'] != identity for name, identity in support_ids.items()):
            raise RuntimeError('A support service changed during the app-only release')
        actual_hash = base.run('docker', 'exec', APP, 'sha256sum', '/app/' + TARGET).split()[0]
        if actual_hash != EXPECTED_PATCHED_ROUTER_SHA:
            raise RuntimeError('Running WooCommerce router hash differs from the reviewed artifact')
    except Exception:
        try:
            base.run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
            rolled_back = base.wait_healthy()
            rolled_back_hash = base.run('docker', 'exec', APP, 'sha256sum', '/app/' + TARGET).split()[0]
            if rolled_back['Image'] != app['Image'] or rolled_back_hash != EXPECTED_LIVE_ROUTER_SHA:
                raise RuntimeError('Automatic app rollback did not restore the recorded router preimage')
            if base.inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
                raise RuntimeError('Database health changed during automatic app rollback')
            if any(base.inspect(name)['Id'] != identity for name, identity in support_ids.items()):
                raise RuntimeError('A support service changed during automatic app rollback')
        except Exception as rollback_error:
            raise RuntimeError('Retail route deployment failed and automatic app rollback also failed') from rollback_error
        raise

    print(json.dumps({'status': 'deployed', 'sourceCommit': commit, 'release': str(release),
                      'rollback': str(backup), 'runtimeRouterSha256': EXPECTED_PATCHED_ROUTER_SHA,
                      'appImage': app['Config']['Image'], 'appOnly': True, 'databaseChanged': False}))


def restore(backup_path):
    base = base_helper()
    base.require_lock()
    backup = Path(backup_path).resolve()
    if backup.parent != ROOT / 'shared' or not backup.name.startswith('rollback-retail-woo-connect-fix-'):
        raise RuntimeError('Rollback path is outside the dedicated Retail snapshot area')
    if not backup.is_dir():
        raise RuntimeError('Rollback snapshot is missing')
    before = json.loads((backup / 'app-before.json').read_text())
    app = base.inspect(APP)
    expected_overlay = (backup / 'overlay-path.txt').read_text().strip()
    labels = app['Config'].get('Labels', {})
    config_files = labels.get('com.docker.compose.project.config_files', '').split(',')
    if expected_overlay not in config_files:
        raise RuntimeError('The target Retail overlay is not active')
    if app['Image'] != before['imageId']:
        raise RuntimeError('App image differs from the rollback baseline')
    meta = {
        'files': read_lines(backup / 'compose-files.before.txt'),
        'env_files': read_lines(backup / 'compose-env-files.before.txt'),
        'workdir': (backup / 'compose-working-dir.txt').read_text().strip(),
    }
    input_hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(path).read_bytes()) != digest for path, digest in input_hashes.items()):
        raise RuntimeError('Compose inputs changed since the rollback snapshot')
    env, _ = base.compose_environment(app, meta)
    common = base.compose_args(meta['files'], meta['env_files'], meta['workdir'])
    db = base.inspect(DB)
    if db['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Database is not healthy; refusing app rollback')
    base.run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = base.wait_healthy()
    restored_hash = base.run('docker', 'exec', APP, 'sha256sum', '/app/' + TARGET).split()[0]
    expected_hash = json.loads((backup / 'router-preimage-hash.json').read_text())['sha256']
    restored_labels = current['Config'].get('Labels', {})
    if current['Image'] != before['imageId'] or restored_hash != expected_hash or \
            restored_labels.get('com.docker.compose.project.config_files') != ','.join(meta['files']):
        raise RuntimeError('Restored app does not match the recorded router preimage')
    support_ids = json.loads((backup / 'support-service-ids.json').read_text())
    if any(base.inspect(name)['Id'] != identity for name, identity in support_ids.items()):
        raise RuntimeError('A support service changed during the app-only rollback')
    print(json.dumps({'status': 'restored', 'appImage': current['Config']['Image'],
                      'routerSha256': restored_hash, 'databaseChanged': False}))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('preflight')
    deployment = sub.add_parser('deploy')
    deployment.add_argument('source_commit')
    rollback = sub.add_parser('restore')
    rollback.add_argument('backup')
    args = parser.parse_args()
    if args.command == 'preflight':
        preflight()
    elif args.command == 'deploy':
        deploy(args.source_commit)
    else:
        restore(args.backup)


if __name__ == '__main__':
    main()
