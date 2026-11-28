#!/usr/bin/env python3
"""Deploy the Retail gallery display and complete WooCommerce import controls."""
import importlib.util
import json
import re
import sys
from pathlib import Path

BASE_HELPER = 'retail-reconciliation-release.py'
MIGRATOR_FILE = 'retail-store-control-audit.cjs'
OVERLAY_FILE = 'compose.retail-gallery-sync.json'
RELEASE_NAME = 'retail-gallery-sync'
PILOT_ENV = 'SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS'
ORIGIN = 'https://7network.live'
IMAGE = 'sha256:c496b845778b8b4258dc3eda2757a18240ced0b0cd70c4ad6baf8328e508e577'
LAST_OVERLAY = '/opt/salemax/releases/retail-product-gallery-7168a3f98900-20261128T075347Z/compose.retail-product-gallery.json'
INDEX = 'client/public/index.html'
OLD_PRODUCT_CACHE = '20261128-retail-product-gallery1'
NEW_PRODUCT_CACHE = '20261128-retail-gallery-sync2'
OLD_WORKSPACE_CACHE = '20261126-retail-store-control1'
NEW_WORKSPACE_CACHE = '20261128-retail-store-control2'

RUNTIME = {
    INDEX,
    'client/public/training-courses.js',
    'client/public/retail-workspace.js',
    'modules/platform/retail-connected-stores-router.js',
}
TOOLS = {
    'deploy/' + BASE_HELPER,
    'deploy/pro-catalyst-center-visit-signal-release.py',
    'deploy/' + MIGRATOR_FILE,
    'deploy/retail-gallery-sync-release.py',
}
ASSETS = {
    'client/public/training-courses.js',
    'client/public/retail-workspace.js',
}

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
        raise RuntimeError('Retail gallery sync stage path is invalid')
    info = original_stage_manifest(stage, commit)
    if (info.get('releaseName') != RELEASE_NAME or info.get('image') != IMAGE or
            info.get('lastOverlay') != LAST_OVERLAY):
        raise RuntimeError('Retail gallery sync stage targets a different production release')
    if set(info.get('runtime', {})) != RUNTIME or set(info.get('preimages', {})) != RUNTIME:
        raise RuntimeError('Retail gallery sync runtime/preimage allowlist differs')
    if set(info.get('tools', {})) != TOOLS or info.get('pending') != []:
        raise RuntimeError('Retail gallery sync tools or no-migration declaration differs')
    if set(info.get('publicAssets', {})) != ASSETS:
        raise RuntimeError('Retail gallery sync public asset allowlist differs')
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
    if (release.ops.sha(prior) != info['preimages'][INDEX] or
            prior.count(OLD_PRODUCT_CACHE.encode()) != 1 or
            prior.count(OLD_WORKSPACE_CACHE.encode()) != 1 or
            NEW_PRODUCT_CACHE.encode() in prior or NEW_WORKSPACE_CACHE.encode() in prior):
        raise RuntimeError('Live production shell does not match the two reviewed old cache keys')
    expected = prior.replace(OLD_PRODUCT_CACHE.encode(), NEW_PRODUCT_CACHE.encode(), 1)
    expected = expected.replace(OLD_WORKSPACE_CACHE.encode(), NEW_WORKSPACE_CACHE.encode(), 1)
    if current != expected:
        raise RuntimeError('Generated production shell includes changes outside the two cache-key updates')
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
        raise RuntimeError('Retail gallery or anonymous-access checks differ')
    for relative, cache in (
        ('client/public/training-courses.js', NEW_PRODUCT_CACHE),
        ('client/public/retail-workspace.js', NEW_WORKSPACE_CACHE),
    ):
        filename = relative.rsplit('/', 1)[1]
        code, data = status('/' + filename + '?v=' + cache)
        if code != 200 or release.ops.sha(data) != hashes[relative]:
            raise RuntimeError('Public Retail asset differs: ' + filename)
    code, shell = status('/user?page=products-services')
    required = (
        '/training-courses.js?v=' + NEW_PRODUCT_CACHE,
        '/retail-workspace.js?v=' + NEW_WORKSPACE_CACHE,
        '/pwa-install.js?v=20261123-sidebar-install1',
    )
    if code != 200 or any(token.encode() not in shell for token in required):
        raise RuntimeError('Production shell lost the reviewed Retail or PWA references')
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
        raise RuntimeError('Reviewed Retail gallery baseline is not the latest active Compose overlay')
    return original_deploy(stage, commit)


release.deploy = deploy


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        release.deploy(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        release.restore(sys.argv[2])
    else:
        raise SystemExit('Usage: retail-gallery-sync-release.py deploy STAGE COMMIT | restore BACKUP')
