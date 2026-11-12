#!/usr/bin/env python3
"""Deploy model-uncertainty guards as a reviewed app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-mobile-sip-guidance-7c6b7d7eb3a8-20261112/compose.call-center-inbound-lead-link.json'
ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-qatar-inbound-fallback-207a2f5a845b-20261112/deploy/call-center-inbound-lead-link-release.py')
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = (
    'modules/platform/asterisk-config.js',
    'modules/platform/asterisk-gateway-ports.js',
    'client/public/admin-asterisk.js',
    'client/public/index.html',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': 'd1d616e219678ba3f8badac5e78477ce528679b924317a8670d362271194b375',
    'modules/platform/asterisk-gateway-ports.js': 'f1027e567c2fa66d6b22dcf773f8373bb4cf9e8244d018b94fa8edbc4b79ad6f',
    'client/public/admin-asterisk.js': '8d49fb15a6f795b9946fd714488068837343b75407faad06b9de205685585f6a',
    'client/public/index.html': '08eb0fcb78b0c846e6aed8b90fc551c331e50ce6e492f90ad6b15c1fe85a7729',
}
HELPER_NAME = 'deploy/7network-dinstar-model-guard-release.py'
RELEASE_PREFIX = 'call-center-dinstar-model-guard'
RELEASE_DAY = '20261112'


def load_helper(source_root=None):
    helper_path = (Path(source_root) / 'deploy' / 'call-center-inbound-lead-link-release.py'
        if source_root is not None else ACTIVE_HELPER)
    spec = importlib.util.spec_from_file_location('seven_network_dinstar_model_guard_base', helper_path)
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
