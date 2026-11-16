#!/usr/bin/env python3
"""Deploy reviewed 7Network SIP credential and inbound-call corrections."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-dinstar-labels-f22faf8a039e-20261116/deploy/7network-dinstar-labels-release.py')
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
REQUIRED_OVERLAYS = (
    '/opt/salemax/releases/call-center-dinstar-model-guard-4069c70da166-20261112/compose.call-center-inbound-lead-link.json',
    '/opt/salemax/releases/call-center-dinstar-labels-f22faf8a039e-20261116/compose.call-center-inbound-lead-link.json',
)
SOURCE_RUNTIME_FILES = (
    'modules/platform/asterisk-ari-client.js',
    'modules/platform/asterisk-call-control.js',
    'modules/platform/asterisk-config.js',
    'modules/platform/telephony-extensions.js',
    'client/public/call-center/call-center.js',
    'client/public/call-center/index.html',
    'client/public/call-center/sip-runtime.js',
)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-ari-client.js': '044bc7308a41e9755dbf336642dc55ffd1527ddb8f0bff73ad93275fd0f34efa',
    'modules/platform/asterisk-call-control.js': 'e719a68d25ee3ade89681f737ea62d8ee164731d0d251098c2e968d8f4ed6684',
    'modules/platform/asterisk-config.js': '6efdd1ff74800a96b285935d29560d020d68625d280b5dcfff7bc4188447af7d',
    'modules/platform/telephony-extensions.js': '4b1446942fd89ddd42f133fb29f155b875271075fd3ca651231014080261a5df',
    'client/public/call-center/call-center.js': 'b58ee7fedd3ad615e1fd2cba28e10214b74e7ed9c4aa8141379d7533439a5175',
    'client/public/call-center/index.html': 'e17884718969ba56a84b2ba3ddb63b7e4b2a6f5cf2923e274dabcfd9aee24dad',
    'client/public/call-center/sip-runtime.js': 'e558fae781344114e83e6957369fa9bda1d44d97eceaff79f8623dc9a2e6cae8',
}
HELPER_NAME = 'deploy/7network-sip-endpoint-revocation-release.py'
RELEASE_PREFIX = 'call-center-sip-endpoint-revocation'
RELEASE_DAY = '20261116'


def load_helper(source_root=None):
    wrapper_path = Path(source_root) / 'deploy' / '7network-dinstar-labels-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_sip_revocation_base', wrapper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the previously deployed Dinstar release helper')
    wrapper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wrapper)
    wrapper.REQUIRED_OVERLAYS = REQUIRED_OVERLAYS
    helper = wrapper.load_helper(source_root)
    helper.RUNTIME_FILES = SOURCE_RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return wrapper, helper


def bind_active_compose_chain(wrapper, helper, app):
    files = wrapper.bind_active_compose_chain(helper, app)
    if any(required not in files for required in REQUIRED_OVERLAYS):
        raise RuntimeError('The live Compose chain is missing a required 7Network Dinstar overlay')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        _, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        wrapper, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(wrapper, helper, helper.inspect(helper.APP))
        helper.deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        _, helper = load_helper()
        helper.restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
