#!/usr/bin/env python3
"""Deploy mobile SIP setup wording as a guarded app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-qatar-inbound-fallback-207a2f5a845b-20261112/compose.call-center-inbound-lead-link.json'
ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-qatar-inbound-fallback-207a2f5a845b-20261112/deploy/call-center-inbound-lead-link-release.py')
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = (
    'modules/platform/asterisk-config.js',
    'client/public/call-center/call-center.js',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': 'dc01e177ad07a62c7b3018efd108799166188514568c2bb9c3755c365b35df36',
    'client/public/call-center/call-center.js': '5a88c577d0a8b18f25c74700c352ee9848c90f15fe79d28a2053a2817f021cf3',
}
HELPER_NAME = 'deploy/call-center-mobile-sip-guidance-release.py'
RELEASE_PREFIX = 'call-center-mobile-sip-guidance'
RELEASE_DAY = '20261112'


def load_helper(source_root=None):
    helper_path = (Path(source_root) / 'deploy' / 'call-center-inbound-lead-link-release.py'
        if source_root is not None else ACTIVE_HELPER)
    spec = importlib.util.spec_from_file_location('call_center_mobile_sip_base_release_helper', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed Call Center release helper')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.ACTIVE_OVERLAY = ACTIVE_OVERLAY
    helper.ACTIVE_HELPER = ACTIVE_HELPER
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return helper


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        load_helper(args[1]).main(args)
    else:
        load_helper().main(args)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
