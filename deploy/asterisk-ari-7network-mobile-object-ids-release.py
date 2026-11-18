#!/usr/bin/env python3
"""Deploy the bounded ARI allowlist for 7Network mobile PJSIP objects."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-zoiper-7network-sip-username-829bb3374a58-20261118/deploy/zoiper-7network-sip-username-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-zoiper-7network-sip-username-829bb3374a58-20261118/compose.call-center-inbound-lead-link.json'
REQUIRED_OVERLAYS = (
    '/opt/salemax/releases/call-center-dinstar-model-guard-4069c70da166-20261112/compose.call-center-inbound-lead-link.json',
    '/opt/salemax/releases/call-center-dinstar-labels-f22faf8a039e-20261116/compose.call-center-inbound-lead-link.json',
    '/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/compose.call-center-inbound-lead-link.json',
    '/opt/salemax/releases/call-center-zoiper-7network-label-0360664733a7-20261118/compose.call-center-inbound-lead-link.json',
    ACTIVE_OVERLAY,
)
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = ('modules/platform/asterisk-ari-client.js',)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-ari-client.js': '3a3cbcbc45e53f07b35505d5ebbc415e8fa090306e25d61a5ef1a8ef35fbb8b9',
}
HELPER_NAME = 'deploy/asterisk-ari-7network-mobile-object-ids-release.py'
RELEASE_PREFIX = 'call-center-ari-7network-mobile-object-ids'
RELEASE_DAY = '20261118'


def load_helper(source_root=None):
    helper_path = (Path(source_root) / 'deploy' / 'zoiper-7network-sip-username-release.py'
        if source_root else ACTIVE_HELPER)
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_base', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed current Zoiper release helper')
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    base, wrapper, helper = previous.load_helper(source_root)
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return base, wrapper, helper


def bind_active_compose_chain(base, wrapper, helper, app):
    files = wrapper.bind_active_compose_chain(helper, app)
    if any(required not in files for required in REQUIRED_OVERLAYS):
        raise RuntimeError('The active Compose chain is missing a reviewed 7Network Call Center overlay')
    if not files or files[-1] != ACTIVE_OVERLAY:
        raise RuntimeError('The active production Compose tail changed since review')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        *_, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        base, wrapper, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(base, wrapper, helper, helper.inspect(helper.APP))
        helper.deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        *_, helper = load_helper()
        helper.restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
