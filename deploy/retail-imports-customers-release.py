#!/usr/bin/env python3
"""Deploy the safe Retail local-snapshot backfill overlay."""
import importlib.util
import re
import sys
from pathlib import Path

BASE_HELPER = 'retail-reconciliation-release.py'
MIGRATOR_FILE = 'retail-imports-customers-migrate.cjs'
OVERLAY_FILE = 'compose.retail-imports-customers.json'
RELEASE_NAME = 'retail-native-import-backfill'
PILOT_ENV = 'SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS'
ORIGIN = 'https://7network.live'
IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
LAST_OVERLAY = '/opt/salemax/releases/retail-native-import-backfill-84e4cb0b8af8-20261125T162628Z/compose.retail-imports-customers.json'
MIGRATION = '20270213_retail_native_store_imports.sql'

RUNTIME = {
    'modules/platform/retail-connected-stores-worker.js',
    'modules/platform/retail-native-import-backfill.js',
}
TOOLS = {
    'deploy/retail-reconciliation-release.py',
    'deploy/pro-catalyst-center-visit-signal-release.py',
    'deploy/retail-imports-customers-release.py',
    'deploy/' + MIGRATOR_FILE,
    'database/migrations/' + MIGRATION,
}
ASSETS = set()

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
        raise RuntimeError('Retail stage targets a different production release')
    if set(info.get('runtime', {})) != RUNTIME or set(info.get('preimages', {})) != RUNTIME:
        raise RuntimeError('Retail stage does not contain the reviewed runtime file set')
    if set(info.get('tools', {})) != TOOLS or info.get('pending') != ['database/migrations/' + MIGRATION]:
        raise RuntimeError('Retail stage tool or migration allowlist differs')
    if set(info.get('publicAssets', {})) != ASSETS:
        raise RuntimeError('Retail stage public asset set differs')
    if not re.fullmatch(r'[0-9a-f]{64}', info['tools']['database/migrations/' + MIGRATION]):
        raise RuntimeError('Retail migration checksum is invalid')
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
        '/user?page=retail-customers': 200,
        '/api/workspace/retail/connectors': 401,
        '/api/workspace/retail/customers': 401,
        '/api/workspace/retail/orders/overview': 401,
    }
    actual = {path: status(path)[0] for path in expected}
    if actual != expected:
        raise RuntimeError('Public Retail routes or anonymous-access checks differ')
    code, shell = status('/user?page=retail-connected-stores')
    if code != 200 or any(token not in shell for token in (b'training-sidebar.js', b'retail-workspace.js', b'pwa-install.js')):
        raise RuntimeError('Live business shell is missing the previously reviewed Retail or PWA assets')
    return actual


release.public_checks = public_checks


def rollback_app(common, environment, image):
    adoption = (
        'SELECT (SELECT COUNT(*) FROM sx_retail_catalogue_imports) + '
        '(SELECT COUNT(*) FROM sx_retail_customer_search_tokens) + '
        '(SELECT COUNT(*) FROM sx_retail_orders WHERE external_source_connection_id IS NOT NULL)'
    )
    sql = ('export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; '
           'exec mariadb --protocol=socket -uroot -N "$MARIADB_DATABASE" -e "$1"')
    if release.ops.run('docker', 'exec', release.ops.DB, 'sh', '-euc', sql, 'retail-imports-rollback', adoption).strip() != '0':
        raise RuntimeError('Adopted native Retail imports require a compatible forward repair')
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
        raise SystemExit('Usage: retail-imports-customers-release.py deploy STAGE COMMIT | restore BACKUP')
