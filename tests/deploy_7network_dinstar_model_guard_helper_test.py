import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-dinstar-model-guard-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_dinstar_model_guard_release_helper', HELPER_PATH)
WRAPPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WRAPPER)


class SevenNetworkDinstarModelGuardReleaseHelperTest(unittest.TestCase):
    def test_helper_is_bound_to_current_overlay_and_exact_runtime_files(self):
        helper = WRAPPER.load_helper(ROOT)
        self.assertEqual(helper.ACTIVE_OVERLAY,
            '/opt/salemax/releases/call-center-mobile-sip-guidance-7c6b7d7eb3a8-20261112/compose.call-center-inbound-lead-link.json')
        self.assertEqual(str(helper.ACTIVE_HELPER),
            '/opt/salemax/releases/call-center-qatar-inbound-fallback-207a2f5a845b-20261112/deploy/call-center-inbound-lead-link-release.py')
        self.assertEqual(helper.RUNTIME_FILES, (
            'modules/platform/asterisk-config.js',
            'modules/platform/asterisk-gateway-ports.js',
            'client/public/admin-asterisk.js',
            'client/public/index.html',
        ))
        self.assertEqual(helper.EXPECTED_PREIMAGES, {
            'modules/platform/asterisk-config.js': 'd1d616e219678ba3f8badac5e78477ce528679b924317a8670d362271194b375',
            'modules/platform/asterisk-gateway-ports.js': 'f1027e567c2fa66d6b22dcf773f8373bb4cf9e8244d018b94fa8edbc4b79ad6f',
            'client/public/admin-asterisk.js': '8d49fb15a6f795b9946fd714488068837343b75407faad06b9de205685585f6a',
            'client/public/index.html': '08eb0fcb78b0c846e6aed8b90fc551c331e50ce6e492f90ad6b15c1fe85a7729',
        })
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-dinstar-model-guard')
        self.assertEqual(helper.HELPER_NAME, 'deploy/7network-dinstar-model-guard-release.py')


if __name__ == '__main__':
    unittest.main()
