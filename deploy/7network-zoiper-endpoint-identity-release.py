#!/usr/bin/env python3
"""Deploy SIP endpoint identity and Asterisk module-readiness corrections."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-outbound-gateway-failure-ffa8deb5c25d-20261117/deploy/7network-outbound-gateway-failure-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-outbound-gateway-failure-ffa8deb5c25d-20261117/compose.call-center-inbound-lead-link.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
SOURCE_RUNTIME_FILES = (
    'modules/platform/asterisk-config.js',
    'client/public/call-center/sip-runtime.js',
    'client/public/call-center/index.html',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': 'a0d620c2139c788e1f62ae2c77fb15ff417519a635cc724cda49669005410e59',
    'client/public/call-center/sip-runtime.js': 'aa550e5dbf9c2753a4db2da127eaf85dfeb1e86bd73a918ca1ad224c6a4ecbbb',
    'client/public/call-center/index.html': '9bbe6893af0889dbc55256b7d0a72edc62bbbea8d1ac8641552d73427e2ad601',
}
HELPER_NAME = 'deploy/7network-zoiper-endpoint-identity-release.py'
RELEASE_PREFIX = 'call-center-zoiper-endpoint-identity'
RELEASE_DAY = '20261117'


def load_helper(source_root=None):
    helper_path = Path(source_root) / 'deploy' / '7network-outbound-gateway-failure-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_endpoint_identity_base', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed outbound GSM failure release helper')
    outbound = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(outbound)
    zoiper, wrapper, parent, helper = outbound.load_helper(source_root)
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = SOURCE_RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return outbound, zoiper, wrapper, parent, helper


def bind_active_compose_chain(outbound, zoiper, wrapper, parent, helper, app):
    files = outbound.bind_active_compose_chain(zoiper, wrapper, parent, helper, app)
    if ACTIVE_OVERLAY not in files:
        raise RuntimeError('The active outbound GSM failure overlay is missing')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        _, _, _, _, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        outbound, zoiper, wrapper, parent, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(outbound, zoiper, wrapper, parent, helper, helper.inspect(helper.APP))
        helper.deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        _, _, _, _, helper = load_helper()
        helper.restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
