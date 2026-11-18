#!/usr/bin/env python3
"""Deploy the Zoiper 7Network account display label as an app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/deploy/7network-sip-endpoint-revocation-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/email-marketing-inbox-diagnostics-e905ecad2aa8-20261118T054906Z/compose.email-marketing-inbox-diagnostics.json'
REVOCATION_OVERLAY = '/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/compose.call-center-inbound-lead-link.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = (
    'client/public/call-center/call-center.js',
    'client/public/call-center/index.html',
)
EXPECTED_PREIMAGES = {
    'client/public/call-center/call-center.js': '70ace20e8d89f0eab224b8d11c0d0da66709ac9d9e5ada220ec77e865115a511',
    'client/public/call-center/index.html': '3511405222d72a4dab4a2c2e2f1549c3c209836c39011cd8166028b1b2bef960',
}
HELPER_NAME = 'deploy/zoiper-7network-display-label-release.py'
RELEASE_PREFIX = 'call-center-zoiper-7network-label'
RELEASE_DAY = '20261118'


def load_helper(source_root=None):
    helper_path = Path(source_root) / 'deploy' / '7network-sip-endpoint-revocation-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_display_label_base', helper_path)
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
