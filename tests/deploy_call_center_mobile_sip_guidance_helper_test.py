import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / 'call-center-mobile-sip-guidance-release.py'
SPEC = importlib.util.spec_from_file_location('call_center_mobile_sip_guidance_release_helper', HELPER_PATH)
WRAPPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WRAPPER)


class CallCenterMobileSipGuidanceReleaseHelperTest(unittest.TestCase):
    def test_helper_is_bound_to_the_current_overlay_and_exact_two_runtime_files(self):
        helper = WRAPPER.load_helper(ROOT)
        self.assertEqual(helper.ACTIVE_OVERLAY,
            '/opt/salemax/releases/call-center-qatar-inbound-fallback-207a2f5a845b-20261112/compose.call-center-inbound-lead-link.json')
        self.assertEqual(helper.RUNTIME_FILES, (
            'modules/platform/asterisk-config.js',
            'client/public/call-center/call-center.js',
        ))
        self.assertEqual(helper.EXPECTED_PREIMAGES, {
            'modules/platform/asterisk-config.js': 'dc01e177ad07a62c7b3018efd108799166188514568c2bb9c3755c365b35df36',
            'client/public/call-center/call-center.js': '5a88c577d0a8b18f25c74700c352ee9848c90f15fe79d28a2053a2817f021cf3',
        })
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-mobile-sip-guidance')
        self.assertEqual(helper.HELPER_NAME, 'deploy/call-center-mobile-sip-guidance-release.py')


if __name__ == '__main__':
    unittest.main()
