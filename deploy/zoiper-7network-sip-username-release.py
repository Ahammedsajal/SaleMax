#!/usr/bin/env python3
"""Deploy 7Network-branded Zoiper SIP identities as an app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/deploy/7network-sip-endpoint-revocation-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-zoiper-7network-label-0360664733a7-20261118/compose.call-center-inbound-lead-link.json'
REVOCATION_OVERLAY = '/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/compose.call-center-inbound-lead-link.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = (
    'modules/platform/asterisk-config.js',
    'modules/platform/asterisk-call-control.js',
    'modules/platform/asterisk-ari-client.js',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': 'dc1f0f850ac9be89ae01027b61bc95b1b74c330302b1dbd08056f115f1a9f5fe',
    'modules/platform/asterisk-call-control.js': '471bd8d6fdb416c6a29e49a50b6ee1c32c25184ce90256fa1fd071af02ef15d8',
    'modules/platform/asterisk-ari-client.js': 'c74f45932f236898025586ca61d04e98f715ef7d9080297a0640ad7d6539a160',
}
HELPER_NAME = 'deploy/zoiper-7network-sip-username-release.py'
RELEASE_PREFIX = 'call-center-zoiper-7network-sip-username'
RELEASE_DAY = '20261118'


def load_helper(source_root=None):
    helper_path = Path(source_root) / 'deploy' / '7network-sip-endpoint-revocation-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_sip_username_base', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed Call Center release helper')
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    wrapper, helper = previous.load_helper(source_root)
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return previous, wrapper, helper


def bind_active_compose_chain(previous, wrapper, helper, app):
    files = previous.bind_active_compose_chain(wrapper, helper, app)
    if REVOCATION_OVERLAY not in files:
        raise RuntimeError('The active SIP endpoint revocation overlay is missing')
    if not files or files[-1] != ACTIVE_OVERLAY:
        raise RuntimeError('The active production Compose tail changed since review')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        *_, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        previous, wrapper, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(previous, wrapper, helper, helper.inspect(helper.APP))
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
