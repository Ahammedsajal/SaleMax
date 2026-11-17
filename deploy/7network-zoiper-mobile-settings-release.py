#!/usr/bin/env python3
"""Deploy precise Zoiper SIP settings as a guarded app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/deploy/7network-sip-endpoint-revocation-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/compose.call-center-inbound-lead-link.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
SOURCE_RUNTIME_FILES = (
    'modules/platform/asterisk-config.js',
    'client/public/call-center/call-center.js',
    'client/public/call-center/index.html',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': '4a37512dce5dca4fc17acfc8364d80509279bac04661742b4694286359fc4cd6',
    'client/public/call-center/call-center.js': '3b382a749edd052debbb2f8ef5445b9dda9059fb89eba8432fdedd07db0ead01',
    'client/public/call-center/index.html': '6b36c4861bb52ba7c1ae1f5e3fb0ab209010f6d5b7523d79408a9ce196b45b36',
}
HELPER_NAME = 'deploy/7network-zoiper-mobile-settings-release.py'
RELEASE_PREFIX = 'call-center-zoiper-mobile-settings'
RELEASE_DAY = '20261117'


def load_helper(source_root=None):
    wrapper_path = Path(source_root) / 'deploy' / '7network-sip-endpoint-revocation-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_previous_release', wrapper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed SIP credential release helper')
    wrapper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wrapper)
    parent, helper = wrapper.load_helper(source_root)
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = SOURCE_RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return wrapper, parent, helper


def bind_active_compose_chain(wrapper, parent, helper, app):
    files = wrapper.bind_active_compose_chain(parent, helper, app)
    if ACTIVE_OVERLAY not in files:
        raise RuntimeError('The live SIP credential revocation overlay is missing')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        _, _, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        wrapper, parent, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(wrapper, parent, helper, helper.inspect(helper.APP))
        helper.deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        _, _, helper = load_helper()
        helper.restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
