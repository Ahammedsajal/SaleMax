#!/usr/bin/env python3
"""Deploy revisioned Zoiper endpoint/AoR identities as an app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-zoiper-aor-identity-e384d0525b38-20261117/deploy/7network-zoiper-aor-identity-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-zoiper-aor-identity-e384d0525b38-20261117/compose.call-center-inbound-lead-link.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = (
    'modules/platform/asterisk-config.js',
    'modules/platform/asterisk-call-control.js',
    'modules/platform/asterisk-ari-client.js',
    'modules/platform/call-center-router.js',
    'client/public/call-center/sip-runtime.js',
    'client/public/call-center/index.html',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': '55136698188b983103a9d3eea97d8124fc9c4aab8424a54718f2bebe7b6a4ae9',
    'modules/platform/asterisk-call-control.js': '2424557efe0546f3298e448d147015e5ce0f69bae6a60a155f6c3f881bd31fa2',
    'modules/platform/asterisk-ari-client.js': '351ab6426ef9f04f93f16e31e9a779089a61addeefaabc24fb572c9f6b54cfc4',
    'modules/platform/call-center-router.js': '1011426bfc84c48c8906f65c111fbcebf6b599fbc12ee54ff0511f9e92f3b981',
    'client/public/call-center/sip-runtime.js': '2b4a9051e0eb42ffc1a0e42cc5fb9f29b4b438004c7cc6138ed47a03bca4f2a1',
    'client/public/call-center/index.html': 'e36907e949c6f68cf1b8745e1e004dca6edfaa34998fdf7f695719da23177763',
}
HELPER_NAME = 'deploy/7network-zoiper-credential-revision-release.py'
RELEASE_PREFIX = 'call-center-zoiper-credential-revision'
RELEASE_DAY = '20261117'


def load_helper(source_root=None):
    helper_path = Path(source_root) / 'deploy' / '7network-zoiper-aor-identity-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_credential_revision_base', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed Zoiper AoR identity release helper')
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    endpoint, outbound, zoiper, wrapper, parent, helper = previous.load_helper(source_root)
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return previous, endpoint, outbound, zoiper, wrapper, parent, helper


def bind_active_compose_chain(previous, endpoint, outbound, zoiper, wrapper, parent, helper, app):
    files = previous.bind_active_compose_chain(endpoint, outbound, zoiper, wrapper, parent, helper, app)
    if ACTIVE_OVERLAY not in files:
        raise RuntimeError('The active Zoiper AoR identity overlay is missing')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        _, _, _, _, _, _, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        previous, endpoint, outbound, zoiper, wrapper, parent, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(previous, endpoint, outbound, zoiper, wrapper, parent, helper, helper.inspect(helper.APP))
        helper.deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        _, _, _, _, _, _, helper = load_helper()
        helper.restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
