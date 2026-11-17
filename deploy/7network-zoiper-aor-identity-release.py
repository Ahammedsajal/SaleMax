#!/usr/bin/env python3
"""Deploy the PJSIP AoR/REGISTER identity correction as an app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-zoiper-endpoint-identity-81317f3a21bd-20261117/deploy/7network-zoiper-endpoint-identity-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-zoiper-endpoint-identity-81317f3a21bd-20261117/compose.call-center-inbound-lead-link.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = ('modules/platform/asterisk-config.js',)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': '1eec636e59830136b95fb6f880b1f3ec51a32da51045d6caf40ddf4342d95cde',
}
HELPER_NAME = 'deploy/7network-zoiper-aor-identity-release.py'
RELEASE_PREFIX = 'call-center-zoiper-aor-identity'
RELEASE_DAY = '20261117'


def load_helper(source_root=None):
    helper_path = Path(source_root) / 'deploy' / '7network-zoiper-endpoint-identity-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_aor_identity_base', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed Zoiper endpoint-identity release helper')
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    outbound, zoiper, wrapper, parent, helper = previous.load_helper(source_root)
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return previous, outbound, zoiper, wrapper, parent, helper


def bind_active_compose_chain(previous, outbound, zoiper, wrapper, parent, helper, app):
    files = previous.bind_active_compose_chain(outbound, zoiper, wrapper, parent, helper, app)
    if ACTIVE_OVERLAY not in files:
        raise RuntimeError('The active Zoiper endpoint-identity overlay is missing')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        _, _, _, _, _, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        previous, outbound, zoiper, wrapper, parent, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(previous, outbound, zoiper, wrapper, parent, helper, helper.inspect(helper.APP))
        helper.deploy(args[1], args[2])
    elif len(args) == 2 and args[0] == 'restore':
        _, _, _, _, _, helper = load_helper()
        helper.restore(args[1])
    else:
        raise RuntimeError('Usage: helper.py stage <source-root> <stage-path> <commit> | deploy <stage> <commit> | restore <rollback>')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'{{"error":"{type(error).__name__}"}}', file=sys.stderr)
        sys.exit(1)
