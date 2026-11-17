#!/usr/bin/env python3
"""Deploy Zoiper background-registration compatibility as an app-only overlay."""
import importlib.util
from pathlib import Path
import sys

ACTIVE_HELPER = Path('/opt/salemax/releases/call-center-zoiper-credential-revision-07570142373e-20261117/deploy/7network-zoiper-credential-revision-release.py')
ACTIVE_OVERLAY = '/opt/salemax/releases/call-center-zoiper-credential-revision-07570142373e-20261117/compose.call-center-inbound-lead-link.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
RUNTIME_FILES = ('modules/platform/asterisk-config.js',)
EXPECTED_PREIMAGES = {
    'modules/platform/asterisk-config.js': '4cd361e47549a4552312577b380525f593887100153c23117ceef78dccdec11f',
}
HELPER_NAME = 'deploy/7network-zoiper-push-registration-release.py'
RELEASE_PREFIX = 'call-center-zoiper-push-registration'
RELEASE_DAY = '20261117'


def load_helper(source_root=None):
    helper_path = Path(source_root) / 'deploy' / '7network-zoiper-credential-revision-release.py' if source_root else ACTIVE_HELPER
    spec = importlib.util.spec_from_file_location('seven_network_zoiper_push_registration_base', helper_path)
    if not spec or not spec.loader:
        raise RuntimeError('Cannot load the reviewed Zoiper credential release helper')
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    aor, endpoint, outbound, zoiper, wrapper, parent, helper = previous.load_helper(source_root)
    helper.EXPECTED_IMAGE = EXPECTED_IMAGE
    helper.RUNTIME_FILES = RUNTIME_FILES
    helper.EXPECTED_PREIMAGES = EXPECTED_PREIMAGES
    helper.HELPER_NAME = HELPER_NAME
    helper.RELEASE_PREFIX = RELEASE_PREFIX
    helper.RELEASE_DAY = RELEASE_DAY
    return previous, aor, endpoint, outbound, zoiper, wrapper, parent, helper


def bind_active_compose_chain(previous, aor, endpoint, outbound, zoiper, wrapper, parent, helper, app):
    files = previous.bind_active_compose_chain(aor, endpoint, outbound, zoiper, wrapper, parent, helper, app)
    if ACTIVE_OVERLAY not in files:
        raise RuntimeError('The active Zoiper credential revision overlay is missing')
    return files


def main(args):
    if len(args) == 4 and args[0] == 'stage':
        *_, helper = load_helper(args[1])
        helper.prepare_stage(args[1], args[2], args[3])
    elif len(args) == 3 and args[0] == 'deploy':
        previous, aor, endpoint, outbound, zoiper, wrapper, parent, helper = load_helper()
        helper.require_production_lock()
        bind_active_compose_chain(previous, aor, endpoint, outbound, zoiper, wrapper, parent, helper,
            helper.inspect(helper.APP))
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
