#!/usr/bin/env python3
"""Deploy imported product publication, local images and the merged Retail customer UI."""
import importlib.util
import re
import sys
from pathlib import Path

BASE_HELPER = 'retail-reconciliation-release.py'
MIGRATOR_FILE = 'retail-product-images-migrate.cjs'
OVERLAY_FILE = 'compose.retail-product-images.json'
RELEASE_NAME = 'retail-product-images'
PILOT_ENV = 'SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS'
ORIGIN = 'https://7network.live'
IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
LAST_OVERLAY = '/opt/salemax/releases/website-network-globe-auto-rotation-4aad677bbd5a-20261126T060500Z/compose.website-network-globe-auto-rotation.json'
MIGRATION = '20270214_retail_product_images_and_publication.sql'
CUSTOMER_CACHE = '20261126-retail-customer-ux1'
PRODUCT_CACHE = '20261126-retail-product-images1'

RUNTIME = {
    'client/public/index.html',
    'client/public/retail-workspace.css',
    'client/public/retail-workspace.js',
    'client/public/training-courses.js',
    'modules/platform/retail-connected-stores-router.js',
    'modules/platform/retail-connected-stores.js',
    'modules/platform/retail-customer-directory.js',
    'modules/platform/retail-native-import-backfill.js',
    'modules/platform/retail-native-imports.js',
    'modules/platform/retail-product-media-imports.js',
    'database/migrations/' + MIGRATION,
}
TOOLS = {
    'deploy/' + BASE_HELPER,
    'deploy/pro-catalyst-center-visit-signal-release.py',
    'deploy/retail-product-images-release.py',
    'deploy/' + MIGRATOR_FILE,
    'deploy/retail-product-images-backfill.cjs',
}
ASSETS = {
    'client/public/retail-workspace.css',
    'client/public/retail-workspace.js',
    'client/public/training-courses.js',
}

spec = importlib.util.spec_from_file_location('retail_release_base', Path(__file__).with_name(BASE_HELPER))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.MIGRATOR_FILE = MIGRATOR_FILE
release.OVERLAY_FILE = OVERLAY_FILE
release.PILOT_ENV = PILOT_ENV

original_stage_manifest = release.stage_manifest


def stage_manifest(stage, commit):
    info = original_stage_manifest(stage, commit)
    if info.get('releaseName') != RELEASE_NAME or info.get('image') != IMAGE or info.get('lastOverlay') != LAST_OVERLAY:
        raise RuntimeError('Retail product stage targets a different production release')
    if set(info.get('runtime', {})) != RUNTIME or set(info.get('preimages', {})) != RUNTIME:
        raise RuntimeError('Retail product stage does not contain the reviewed runtime file set')
    if set(info.get('tools', {})) != TOOLS or info.get('pending') != ['database/migrations/' + MIGRATION]:
        raise RuntimeError('Retail product stage tool or migration allowlist differs')
    if set(info.get('publicAssets', {})) != ASSETS:
        raise RuntimeError('Retail product stage public asset set differs')
    if not re.fullmatch(r'[0-9a-f]{64}', info['runtime']['database/migrations/' + MIGRATION]):
        raise RuntimeError('Retail product migration checksum is invalid')
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
        '/user?page=retail-customers': 200,
        '/user?page=retail-connected-stores': 200,
        '/api/workspace/products-services': 401,
        '/api/workspace/retail/customers': 401,
        '/api/workspace/retail/connectors': 401,
        '/api/workspace/retail/orders/overview': 401,
    }
    actual = {path: status(path)[0] for path in expected}
    if actual != expected:
        raise RuntimeError('Retail product routes or anonymous-access checks differ')
    for relative, query in (
        ('client/public/retail-workspace.css', CUSTOMER_CACHE),
        ('client/public/retail-workspace.js', CUSTOMER_CACHE),
        ('client/public/training-courses.js', PRODUCT_CACHE),
    ):
        filename = relative.rsplit('/', 1)[1]
        code, data = status('/' + filename + '?v=' + query)
        if code != 200 or release.ops.sha(data) != hashes[relative]:
            raise RuntimeError('Public Retail asset differs: ' + filename)
    code, shell = status('/user?page=products-services')
    if code != 200 or any(token.encode() not in shell for token in (
        '/retail-workspace.js?v=' + CUSTOMER_CACHE,
        '/training-courses.js?v=' + PRODUCT_CACHE,
        '/pwa-install.js?v=20261123-sidebar-install1',
    )):
        raise RuntimeError('Live business shell is missing a reviewed Retail asset or preserved PWA reference')
    return actual


release.public_checks = public_checks


def rollback_app(common, environment, image):
    # The migration is additive; keep it applied and restore only the prior app overlay.
    release.ops.run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=environment)
    current = release.ops.wait_healthy()
    if current['Image'] != image:
        raise RuntimeError('Restored application image differs')


release.rollback_app = rollback_app


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        release.deploy(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        release.restore(sys.argv[2])
    else:
        raise SystemExit('Usage: retail-product-images-release.py deploy STAGE COMMIT | restore BACKUP')
