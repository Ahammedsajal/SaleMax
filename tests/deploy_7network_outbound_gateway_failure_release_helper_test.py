import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-outbound-gateway-failure-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_outbound_gateway_failure_release', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class SevenNetworkOutboundGatewayFailureReleaseHelperTest(unittest.TestCase):
    def test_release_preserves_current_zoiper_overlay_and_limits_runtime_scope(self):
        zoiper, wrapper, parent, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(RELEASE.ACTIVE_OVERLAY,
            '/opt/salemax/releases/call-center-zoiper-mobile-settings-766367f67fd0-20261117/compose.call-center-inbound-lead-link.json')
        self.assertEqual(helper.RUNTIME_FILES, ('modules/platform/asterisk-call-control.js',))
        self.assertEqual(helper.EXPECTED_IMAGE, RELEASE.EXPECTED_IMAGE)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        self.assertEqual(helper.HELPER_NAME, RELEASE.HELPER_NAME)
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-outbound-gateway-failure')
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *wrapper.REQUIRED_OVERLAYS, zoiper.ACTIVE_OVERLAY, RELEASE.ACTIVE_OVERLAY)
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(zoiper, wrapper, parent, helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, files[-1])

        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(files[:-1])
        with self.assertRaisesRegex(RuntimeError, 'active Zoiper Call Center overlay is missing'):
            RELEASE.bind_active_compose_chain(zoiper, wrapper, parent, helper, app)

    def test_stage_contains_only_committed_call_control_and_reviewed_release_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        _, _, _, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.SOURCE_RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
