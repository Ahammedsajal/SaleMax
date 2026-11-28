#!/usr/bin/env python3
"""Deploy the reviewed Retail product image gallery as an app-only overlay."""
import importlib.util
import json
import re
import sys
from pathlib import Path

BASE_HELPER = 'retail-product-images-release.py'
MIGRATOR_FILE = 'retail-product-gallery-migrate.cjs'
OVERLAY_FILE = 'compose.retail-product-gallery.json'
RELEASE_NAME = 'retail-product-gallery'
PILOT_ENV = 'SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS'
ORIGIN = 'https://7network.live'
IMAGE = 'sha256:c496b845778b8b4258dc3eda2757a18240ced0b0cd70c4ad6baf8328e508e577'
LAST_OVERLAY = '/opt/salemax/releases/pro-catalyst-course-intent-guard-bb50f19fc7f7-20261128T062240Z/compose.pro-catalyst-course-intent-guard.json'
MIGRATION = '20270215_retail_product_image_gallery.sql'
OLD_CACHE = '20261126-retail-product-images1'
NEW_CACHE = '20261128-retail-product-gallery1'
INDEX = 'client/public/index.html'

RUNTIME = {
    INDEX,
    'client/public/training-courses.js',
    'modules/platform/retail-connected-stores.js',
    'modules/platform/retail-native-import-backfill.js',
    'modules/platform/retail-native-imports.js',
    'modules/platform/retail-product-media-imports.js',
    'modules/platform/retail-shopify-sync.js',
    'database/migrations/' + MIGRATION,
}
TOOLS = {
    'deploy/pro-catalyst-center-visit-signal-release.py',
    'deploy/retail-product-gallery-backfill.cjs',
    'deploy/retail-product-gallery-migrate.cjs',
    'deploy/retail-product-gallery-release.py',
    'deploy/retail-product-images-release.py',
    'deploy/retail-reconciliation-release.py',
}
ASSETS = {'client/public/training-courses.js'}

spec = importlib.util.spec_from_file_location('retail_product_images_base', Path(__file__).with_name(BASE_HELPER))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
release = base.release
ops = release.ops
release.MIGRATOR_FILE = MIGRATOR_FILE
release.OVERLAY_FILE = OVERLAY_FILE
release.PILOT_ENV = PILOT_ENV

original_stage_manifest = release.stage_manifest


def stage_manifest(stage, commit):
    stage = Path(stage)
    if stage.is_symlink() or not stage.is_dir():
        raise RuntimeError('Retail gallery stage path is invalid')
    info = json.loads((stage / 'manifest.json').read_text())
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or info.get('commit') != commit:
        raise RuntimeError('Unexpected Git source commit')
    if (info.get('releaseName') != RELEASE_NAME or info.get('image') != IMAGE or
            info.get('lastOverlay') != LAST_OVERLAY):
        raise RuntimeError('Retail gallery stage targets a different production release')
    if set(info.get('runtime', {})) != RUNTIME or set(info.get('preimages', {})) != RUNTIME:
        raise RuntimeError('Retail gallery runtime or preimage allowlist differs')
    if set(info.get('tools', {})) != TOOLS or info.get('pending') != ['database/migrations/' + MIGRATION]:
        raise RuntimeError('Retail gallery tools or migration allowlist differs')
    if set(info.get('publicAssets', {})) != ASSETS:
        raise RuntimeError('Retail gallery public asset allowlist differs')
    for relative, checksum in {**info['runtime'], **info['tools']}.items():
        if not re.fullmatch(r'[0-9a-f]{64}', str(checksum)):
            raise RuntimeError('Invalid staged artifact checksum')
        source = stage / relative
        if source.is_symlink() or not source.is_file() or base.file_sha(source) != checksum:
            raise RuntimeError('Staged Retail source hash differs: ' + relative)
    preimage = stage / 'preimages' / INDEX
    shell = stage / INDEX
    prior = preimage.read_bytes()
    current = shell.read_bytes()
    if (ops.sha(prior) != info['preimages'][INDEX] or
            prior.count(OLD_CACHE.encode()) != 1 or NEW_CACHE.encode() in prior or
            current != prior.replace(OLD_CACHE.encode(), NEW_CACHE.encode(), 1)):
        raise RuntimeError('Generated production shell must contain only the reviewed cache-key change')
    if not re.fullmatch(r'[0-9a-f]{64}', info['runtime']['database/migrations/' + MIGRATION]):
        raise RuntimeError('Retail gallery migration checksum is invalid')
    return info


release.stage_manifest = stage_manifest


def status(path):
    return base.status(path)


def public_checks(hashes):
    expected = {
        '/healthz': 200,
        '/user/login': 200,
        '/admin/login': 200,
        '/user?page=products-services': 200,
        '/api/workspace/products-services': 401,
        '/api/workspace/retail/connectors': 401,
    }
    actual = {path: status(path)[0] for path in expected}
    if actual != expected:
        raise RuntimeError('Retail product or anonymous-access checks differ')
    url = '/training-courses.js?v=' + NEW_CACHE
    code, data = status(url)
    if code != 200 or ops.sha(data) != hashes['client/public/training-courses.js']:
        raise RuntimeError('Public product gallery asset differs')
    code, shell = status('/user?page=products-services')
    required = (
        '/training-courses.js?v=' + NEW_CACHE,
        '/retail-workspace.js?',
        '/pwa-install.js?v=20261123-sidebar-install1',
    )
    if code != 200 or any(token.encode() not in shell for token in required):
        raise RuntimeError('Generated shell lost a preserved Retail or PWA reference')
    return actual


release.public_checks = public_checks
original_deploy = release.deploy


def deploy(stage, commit):
    info = stage_manifest(stage, commit)
    app = ops.inspect(ops.APP)
    files, _, _ = ops.compose_context(app)
    if not files or files[-1] != info['lastOverlay']:
        raise RuntimeError('Reviewed Retail baseline is not the latest active Compose overlay')
    return original_deploy(stage, commit)


release.deploy = deploy


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        release.deploy(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        release.restore(sys.argv[2])
    else:
        raise SystemExit('Usage: retail-product-gallery-release.py deploy STAGE COMMIT | restore BACKUP')
