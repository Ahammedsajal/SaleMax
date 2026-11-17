#!/usr/bin/env python3
"""Deploy verified Dinstar model labels as an app-only overlay."""
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys

REQUIRED_OVERLAYS = (
    '/opt/salemax/releases/call-center-dinstar-model-guard-4069c70da166-20261112/compose.call-center-inbound-lead-link.json',
)
ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-qatar-inbound-fallback-207a2f5a845b-20261112/deploy/call-center-inbound-lead-link-release.py')
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
SOURCE_RUNTIME_FILES = (
    'modules/platform/call-center-router.js',
    'modules/platform/tenant-asterisk-gateways.js',
    'client/public/admin-telephony.js',
    'client/public/call-center/index.html',
)
INDEX_FILE = 'client/public/index.html'
OLD_ADMIN_TELEPHONY_ASSET = b'admin-telephony.js?v=20261012-tls-readonly2'
NEW_ADMIN_TELEPHONY_ASSET = b'admin-telephony.js?v=20261116-dinstar-model-caveat1'
EXPECTED_PREIMAGES = {
    'modules/platform/call-center-router.js': '59badc7dbfbe77dc2e570ed9a0f4d3843fafe431b5a631ee9f8d1ff6011f682a',
    'modules/platform/tenant-asterisk-gateways.js': '30409f1c765e2ea4c7841335595f1155119aae7dc3689a39ba2df02acd831b1b',
    'client/public/admin-telephony.js': '649852f14abcc3fa54ed59fddfbe68f2178979685ca6047a9dfddf7b4d52e038',
    'client/public/call-center/index.html': 'a6a1140474b7a6b528aa9cf05e41d56fe35841e37fd9ecfec64c3f4c3efd78b8',
    'client/public/index.html': '72d89f9ad115a7a2c9eceab3e189319d76731c07b348bbb9e8c400226c03984d',
}
HELPER_NAME = 'deploy/7network-dinstar-labels-release.py'
RELEASE_PREFIX = 'call-center-dinstar-labels'
RELEASE_DAY = '20261116'


def patch_admin_telephony_index(index, expected_preimage):
    if hashlib.sha256(index).hexdigest() != expected_preimage:
        raise RuntimeError('Live production index differs from the reviewed preimage')
    if index.count(OLD_ADMIN_TELEPHONY_ASSET) != 1:
        raise RuntimeError('Expected exactly one reviewed admin telephony asset URL')
    return index.replace(OLD_ADMIN_TELEPHONY_ASSET, NEW_ADMIN_TELEPHONY_ASSET, 1)


def bind_active_compose_chain(helper, app):
    labels = app.get('Config', {}).get('Labels', {}) or {}
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    if not files or not files[-1]:
        raise RuntimeError('Active Compose chain cannot be read from the app container')
    if any(required not in files for required in REQUIRED_OVERLAYS):
        raise RuntimeError('Required Dinstar model guard overlay is not active')
    helper.ACTIVE_OVERLAY = files[-1]
    return tuple(files)


def prepare_live_index(helper, stage, commit):
    stage = Path(stage)
    if stage.is_symlink() or not stage.is_dir():
        raise RuntimeError('Stage directory is missing or is a symlink')
    manifest_path = stage / 'manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError('Stage manifest is missing or is a symlink')
    manifest = json.loads(manifest_path.read_text())
    expected_source_files = set(SOURCE_RUNTIME_FILES) | {HELPER_NAME}
    if manifest.get('sourceCommit') != commit or set(manifest.get('files', {})) != expected_source_files:
        raise RuntimeError('Stage manifest differs from the reviewed source')

    result = subprocess.run(
        ['docker', 'exec', helper.APP, 'cat', '/app/' + INDEX_FILE],
        capture_output=True, check=True,
    )
    live_index = result.stdout
    patched_index = patch_admin_telephony_index(live_index, EXPECTED_PREIMAGES[INDEX_FILE])
    index_target = stage / 'runtime' / INDEX_FILE
    if index_target.is_symlink() or index_target.exists():
        raise RuntimeError('Staged index already exists; refusing to overwrite it')
    index_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    index_target.write_bytes(patched_index)
    index_target.chmod(0o644)

    manifest['files'][INDEX_FILE] = hashlib.sha256(patched_index).hexdigest()
    manifest['liveDerivedFiles'] = {
        INDEX_FILE: {
            'preimageSha256': EXPECTED_PREIMAGES[INDEX_FILE],
            'resultSha256': manifest['files'][INDEX_FILE],
            'replacement': {
                'from': OLD_ADMIN_TELEPHONY_ASSET.decode('ascii'),
                'to': NEW_ADMIN_TELEPHONY_ASSET.decode('ascii'),
            },
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')


def load_helper(source_root=None):
    helper_path = (Path(source_root) / 'deploy' / 'call-center-inbound-lead-link-release.py'
        if source_root is not None else ACTIVE_HELPER)
    spec = importlib.util.spec_from_file_location('seven_network_dinstar_labels_base', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed Call Center release helper')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.RUNTIME_FILES = SOURCE_RUNTIME_FILES
    helper.ACTIVE_OVERLAY = None
    helper.ACTIVE_HELPER = ACTIVE_HELPER
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = SOURCE_RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    original_compose_context = helper.compose_context

    def guarded_compose_context(app):
        files, env_files, workdir = original_compose_context(app)
        if any(required not in files for required in REQUIRED_OVERLAYS):
            raise RuntimeError('Required Dinstar model guard overlay is not active')
        return files, env_files, workdir

    helper.compose_context = guarded_compose_context
    return helper


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        load_helper(args[1]).main(args)
    elif len(args) == 3 and args[0] == 'deploy':
        helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(helper, helper.inspect(helper.APP))
        prepare_live_index(helper, args[1], args[2])
        helper.RUNTIME_FILES = SOURCE_RUNTIME_FILES + (INDEX_FILE,)
        helper.main(args)
    else:
        load_helper().main(args)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
