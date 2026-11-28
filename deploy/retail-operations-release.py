#!/usr/bin/env python3
"""Release the read-only Retail operations screens as a guarded app overlay."""
import importlib.util
import json
import re
import sys
from pathlib import Path

BASE_HELPER = 'retail-reconciliation-release.py'
RELEASE_NAME = 'retail-operations'
ORIGIN = 'https://7network.live'
IMAGE = 'sha256:c496b845778b8b4258dc3eda2757a18240ced0b0cd70c4ad6baf8328e508e577'
LAST_OVERLAY = '/opt/salemax/releases/retail-analytics-customers-fb5160677b2a-20261128T140619Z/compose.retail-analytics-customers.json'
OLD_CACHE = '20261128-retail-analytics-customers1'
OLD_INVENTORY_CACHE = '20261124-retail-reconciliation'
NEW_CACHE = '20261128-retail-operations1'

RUNTIME = {
    'client/public/index.html',
    'client/public/retail-workspace.js',
    'client/public/retail-workspace.css',
    'client/public/business-inventory.js',
    'modules/platform/retail-commerce-router.js',
    'modules/platform/retail-customer-directory.js',
    'modules/platform/business-inventory-router.js',
}
TOOLS = {
    'deploy/retail-reconciliation-release.py',
    'deploy/pro-catalyst-center-visit-signal-release.py',
    'deploy/retail-reconciliation-migrate.cjs',
    'deploy/retail-operations-release.py',
}
ASSETS = {
    'client/public/retail-workspace.js',
    'client/public/retail-workspace.css',
    'client/public/business-inventory.js',
}

spec = importlib.util.spec_from_file_location('retail_reconciliation_base', Path(__file__).with_name(BASE_HELPER))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.RELEASE_NAME = RELEASE_NAME
release.ORIGIN = ORIGIN
original_stage_manifest = release.stage_manifest


def stage_manifest(stage, commit):
    stage = Path(stage)
    if stage.is_symlink() or not stage.is_dir():
        raise RuntimeError('Retail operations stage path is invalid')
    info = original_stage_manifest(stage, commit)
    if info.get('releaseName') != RELEASE_NAME or info.get('image') != IMAGE or info.get('lastOverlay') != LAST_OVERLAY:
        raise RuntimeError('Retail operations stage targets a different production baseline')
    if set(info.get('runtime', {})) != RUNTIME or set(info.get('preimages', {})) != RUNTIME:
        raise RuntimeError('Retail operations runtime/preimage allowlist differs')
    if set(info.get('tools', {})) != TOOLS or info.get('pending') != []:
        raise RuntimeError('Retail operations tools or migration declaration differs')
    if set(info.get('publicAssets', {})) != ASSETS:
        raise RuntimeError('Retail operations public asset allowlist differs')
    for relative, digest in {**info['runtime'], **info['tools']}.items():
        if not re.fullmatch(r'[0-9a-f]{64}', str(digest)):
            raise RuntimeError('Invalid staged artifact checksum')
        source = stage / relative
        if source.is_symlink() or not source.is_file() or release.ops.sha(source.read_bytes()) != digest:
            raise RuntimeError('Staged Retail operations source hash differs: ' + relative)
    for relative in ASSETS:
        if info['runtime'][relative] != info['publicAssets'][relative]:
            raise RuntimeError('Public asset hash differs from runtime source: ' + relative)
    previous = (stage / 'preimages' / 'client/public/index.html').read_bytes()
    current = (stage / 'client/public/index.html').read_bytes()
    expected_shell = previous.replace(OLD_CACHE.encode(), NEW_CACHE.encode(), 1)
    expected_shell = expected_shell.replace(OLD_INVENTORY_CACHE.encode(), NEW_CACHE.encode(), 1)
    if (release.ops.sha(previous) != info['preimages']['client/public/index.html'] or
            previous.count(OLD_CACHE.encode()) != 1 or previous.count(OLD_INVENTORY_CACHE.encode()) != 1 or
            NEW_CACHE.encode() in previous or current != expected_shell):
        raise RuntimeError('Production shell is not the reviewed Retail cache-key update')
    app = (stage / 'client/public/retail-workspace.js').read_text()
    inventory = (stage / 'client/public/business-inventory.js').read_text()
    commerce = (stage / 'modules/platform/retail-commerce-router.js').read_text()
    directory = (stage / 'modules/platform/retail-customer-directory.js').read_text()
    if ('delivery_attention' not in app or 'returning' not in app or 'sx-retail-order-drawer' not in app or
            'Order total less item totals' not in app or 'Low stock only' not in inventory or
            "external_source_connection_id IS NULL AND o.fulfillment='delivery'" not in commerce or
            'COUNT(*)>1' not in directory):
        raise RuntimeError('Staged Retail operations behavior is incomplete')
    return info


release.stage_manifest = stage_manifest


def status(path):
    return release.status(path)


def public_checks(hashes):
    expected = {
        '/healthz': 200,
        '/user/login': 200,
        '/admin/login': 200,
        '/user?page=retail-orders': 200,
        '/user?page=retail-customers': 200,
        '/user?page=business-inventory': 200,
        '/api/workspace/retail/orders/overview': 401,
        '/api/workspace/retail/customers': 401,
        '/api/workspace/business-inventory/locations': 401,
    }
    actual = {path: status(path)[0] for path in expected}
    if actual != expected:
        raise RuntimeError('Retail operations health, page, or anonymous-access checks differ')
    asset_urls = {
        'client/public/retail-workspace.js': '/retail-workspace.js?v=' + NEW_CACHE,
        'client/public/retail-workspace.css': '/retail-workspace.css?v=' + NEW_CACHE,
        'client/public/business-inventory.js': '/business-inventory.js?v=' + NEW_CACHE,
    }
    for asset, url in asset_urls.items():
        code, data = status(url)
        if code != 200 or release.ops.sha(data) != hashes[asset]:
            raise RuntimeError('Public Retail operations asset differs: ' + asset)
    code, shell = status('/user?page=retail-orders')
    if code != 200 or ('/retail-workspace.js?v=' + NEW_CACHE).encode() not in shell:
        raise RuntimeError('Production shell is missing the new Retail workspace cache key')
    return actual


release.public_checks = public_checks
original_deploy = release.deploy


def deploy(stage, commit):
    info = stage_manifest(stage, commit)
    app = release.ops.inspect(release.ops.APP)
    files, _, _ = release.ops.compose_context(app)
    if not files or files[-1] != info['lastOverlay']:
        raise RuntimeError('Reviewed Retail production overlay is no longer the latest Compose input')
    return original_deploy(stage, commit)


release.deploy = deploy


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        release.deploy(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        release.restore(sys.argv[2])
    else:
        raise SystemExit('Usage: retail-operations-release.py deploy STAGE COMMIT | restore BACKUP')
