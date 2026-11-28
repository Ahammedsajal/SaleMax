#!/usr/bin/env python3
"""Deploy the WooCommerce Analytics customer import using the active Retail overlay."""
import importlib.util
import re
import sys
from pathlib import Path

BASE_HELPER = 'retail-reconciliation-release.py'
MIGRATOR_FILE = 'retail-store-control-audit.cjs'
OVERLAY_FILE = 'compose.retail-analytics-customers.json'
RELEASE_NAME = 'retail-analytics-customers'
PILOT_ENV = 'SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS'
ORIGIN = 'https://7network.live'
IMAGE = 'sha256:c496b845778b8b4258dc3eda2757a18240ced0b0cd70c4ad6baf8328e508e577'
LAST_OVERLAY = '/opt/salemax/releases/retail-import-sync-794e450f5e71-20261128T114706Z/compose.retail-import-sync.json'
INDEX = 'client/public/index.html'
OLD_CACHE = '20261128-retail-import-sync1'
NEW_CACHE = '20261128-retail-analytics-customers1'

RUNTIME = {INDEX, 'client/public/retail-workspace.js', 'modules/platform/retail-connected-stores-router.js'}
TOOLS = {
    'deploy/' + BASE_HELPER,
    'deploy/pro-catalyst-center-visit-signal-release.py',
    'deploy/' + MIGRATOR_FILE,
    'deploy/retail-analytics-customers-release.py',
}
ASSETS = {'client/public/retail-workspace.js'}

spec = importlib.util.spec_from_file_location('retail_reconciliation_base', Path(__file__).with_name(BASE_HELPER))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.MIGRATOR_FILE = MIGRATOR_FILE
release.OVERLAY_FILE = OVERLAY_FILE
release.PILOT_ENV = PILOT_ENV
release.ORIGIN = ORIGIN
original_stage_manifest = release.stage_manifest


def stage_manifest(stage, commit):
    stage = Path(stage)
    if stage.is_symlink() or not stage.is_dir():
        raise RuntimeError('Retail analytics customer stage path is invalid')
    info = original_stage_manifest(stage, commit)
    if (info.get('releaseName') != RELEASE_NAME or info.get('image') != IMAGE or
            info.get('lastOverlay') != LAST_OVERLAY):
        raise RuntimeError('Retail analytics customer stage targets a different production release')
    if set(info.get('runtime', {})) != RUNTIME or set(info.get('preimages', {})) != RUNTIME:
        raise RuntimeError('Retail analytics customer runtime/preimage allowlist differs')
    if set(info.get('tools', {})) != TOOLS or info.get('pending') != []:
        raise RuntimeError('Retail analytics customer tools or migration declaration differs')
    if set(info.get('publicAssets', {})) != ASSETS:
        raise RuntimeError('Retail analytics customer public asset allowlist differs')
    for relative, checksum in {**info['runtime'], **info['tools']}.items():
        if not re.fullmatch(r'[0-9a-f]{64}', str(checksum)):
            raise RuntimeError('Invalid staged artifact checksum')
        source = stage / relative
        if source.is_symlink() or not source.is_file() or release.ops.sha(source.read_bytes()) != checksum:
            raise RuntimeError('Staged Retail source hash differs: ' + relative)
    for relative in ASSETS:
        if info['runtime'][relative] != info['publicAssets'][relative]:
            raise RuntimeError('Public asset checksum differs from runtime source: ' + relative)
    prior = (stage / 'preimages' / INDEX).read_bytes()
    current = (stage / INDEX).read_bytes()
    if (release.ops.sha(prior) != info['preimages'][INDEX] or prior.count(OLD_CACHE.encode()) != 1 or
            NEW_CACHE.encode() in prior or current != prior.replace(OLD_CACHE.encode(), NEW_CACHE.encode(), 1)):
        raise RuntimeError('Production shell contains more than the Retail asset cache-key update')
    script = (stage / 'client/public/retail-workspace.js').read_text()
    router = (stage / 'modules/platform/retail-connected-stores-router.js').read_text()
    if ('Woo customer records, including guests; matching emails share one profile' not in script or
            'wc-analytics/reports/customers' not in router or 'wc-analytics-customers-v1' not in router):
        raise RuntimeError('Staged Retail customer import behavior is missing')
    return info


release.stage_manifest = stage_manifest


def status(path):
    return release.status(path)


def public_checks(hashes):
    expected = {
        '/healthz': 200,
        '/user/login': 200,
        '/admin/login': 200,
        '/user?page=products-services': 200,
        '/user?page=retail-connected-stores': 200,
        '/user?page=retail-orders&source=online': 200,
        '/api/workspace/products-services': 401,
        '/api/workspace/retail/connectors': 401,
        '/api/workspace/retail/orders/overview': 401,
        '/api/workspace/retail/customers': 401,
    }
    actual = {path: status(path)[0] for path in expected}
    if actual != expected:
        raise RuntimeError('Retail customer release or anonymous-access checks differ')
    asset = 'client/public/retail-workspace.js'
    code, data = status('/retail-workspace.js?v=' + NEW_CACHE)
    if code != 200 or release.ops.sha(data) != hashes[asset]:
        raise RuntimeError('Public Retail customer asset differs')
    code, shell = status('/user?page=retail-connected-stores')
    if code != 200 or ('/retail-workspace.js?v=' + NEW_CACHE).encode() not in shell:
        raise RuntimeError('Production shell is missing the Retail customer sync asset')
    return actual


release.public_checks = public_checks


def rollback_app(common, environment, image):
    release.ops.run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=environment)
    if release.ops.wait_healthy()['Image'] != image:
        raise RuntimeError('Restored application image differs')


release.rollback_app = rollback_app
original_deploy = release.deploy


def deploy(stage, commit):
    info = stage_manifest(stage, commit)
    app = release.ops.inspect(release.ops.APP)
    files, _, _ = release.ops.compose_context(app)
    if not files or files[-1] != info['lastOverlay']:
        raise RuntimeError('Retail import sync overlay is not the latest active Compose overlay')
    return original_deploy(stage, commit)


release.deploy = deploy


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        release.deploy(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        release.restore(sys.argv[2])
    else:
        raise SystemExit('Usage: retail-analytics-customers-release.py deploy STAGE COMMIT | restore BACKUP')
