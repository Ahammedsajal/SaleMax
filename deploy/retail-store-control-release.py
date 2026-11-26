#!/usr/bin/env python3
"""Deploy the Store Connections control-center UI/API overlay without database mutations."""
import importlib.util
import re
import sys
from pathlib import Path

BASE_HELPER = 'retail-reconciliation-release.py'
MIGRATOR_FILE = 'retail-store-control-audit.cjs'
OVERLAY_FILE = 'compose.retail-store-control.json'
RELEASE_NAME = 'retail-store-control'
PILOT_ENV = 'SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS'
ORIGIN = 'https://7network.live'
IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
LAST_OVERLAY = '/opt/salemax/releases/phonebook-add-email-2f22bc7b3ff7-20261126T080042Z/deploy/compose.phonebook-add-email-2f22bc7b3ff7-20261126T080042Z.json'
CACHE = '20261126-retail-store-control1'

RUNTIME = {
    'client/public/index.html',
    'client/public/retail-workspace.css',
    'client/public/retail-workspace.js',
    'modules/platform/retail-connected-stores-router.js',
}
TOOLS = {
    'deploy/' + BASE_HELPER,
    'deploy/pro-catalyst-center-visit-signal-release.py',
    'deploy/retail-store-control-release.py',
    'deploy/' + MIGRATOR_FILE,
}
ASSETS = {
    'client/public/retail-workspace.css',
    'client/public/retail-workspace.js',
}

spec = importlib.util.spec_from_file_location('retail_store_control_base', Path(__file__).with_name(BASE_HELPER))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.MIGRATOR_FILE = MIGRATOR_FILE
release.OVERLAY_FILE = OVERLAY_FILE
release.PILOT_ENV = PILOT_ENV
release.ORIGIN = ORIGIN

original_stage_manifest = release.stage_manifest


def stage_manifest(stage, commit):
    info = original_stage_manifest(stage, commit)
    if info.get('releaseName') != RELEASE_NAME or info.get('image') != IMAGE or info.get('lastOverlay') != LAST_OVERLAY:
        raise RuntimeError('Retail Store Connections stage targets a different production release')
    if set(info.get('runtime', {})) != RUNTIME or set(info.get('preimages', {})) != RUNTIME:
        raise RuntimeError('Retail Store Connections stage runtime/preimage allowlist differs')
    if set(info.get('tools', {})) != TOOLS or info.get('pending') != []:
        raise RuntimeError('Retail Store Connections stage tools or no-migration declaration differs')
    if set(info.get('publicAssets', {})) != ASSETS:
        raise RuntimeError('Retail Store Connections public asset set differs')
    for relative in ASSETS:
        if info['runtime'][relative] != info['publicAssets'][relative]:
            raise RuntimeError('Public asset checksum differs from runtime source: ' + relative)
    page = (stage / 'client/public/index.html').read_text()
    script = (stage / 'client/public/retail-workspace.js').read_text()
    if CACHE not in page or CACHE not in script or '20261126-retail-customer-ux1' in page + script:
        raise RuntimeError('Retail Store Connections cache reference is stale')
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
        '/user?page=retail-orders&source=online': 200,
        '/api/workspace/retail/connectors': 401,
        '/api/workspace/retail/orders/overview': 401,
        '/api/workspace/retail/orders/online': 401,
    }
    actual = {path: status(path)[0] for path in expected}
    if actual != expected:
        raise RuntimeError('Retail Store Connections routes or anonymous-access checks differ')
    for relative in ('client/public/retail-workspace.css', 'client/public/retail-workspace.js'):
        filename = relative.rsplit('/', 1)[1]
        code, data = status('/' + filename + '?v=' + CACHE)
        if code != 200 or release.ops.sha(data) != hashes[relative]:
            raise RuntimeError('Public Store Connections asset differs: ' + filename)
    code, shell = status('/user?page=retail-connected-stores')
    if code != 200 or ('/retail-workspace.js?v=' + CACHE).encode() not in shell:
        raise RuntimeError('Live business shell is missing the reviewed Store Connections script reference')
    return actual


release.public_checks = public_checks


def rollback_app(common, environment, image):
    # This overlay changes only the compatible Retail UI and connection-list projection.
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
        raise SystemExit('Usage: retail-store-control-release.py deploy STAGE COMMIT | restore BACKUP')
