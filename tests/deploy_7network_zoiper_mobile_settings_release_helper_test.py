import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-zoiper-mobile-settings-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_zoiper_release_helper', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class SevenNetworkZoiperMobileSettingsReleaseHelperTest(unittest.TestCase):
    def test_release_is_bound_to_current_call_center_overlay_and_only_three_reviewed_files(self):
        wrapper, parent, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(RELEASE.ACTIVE_OVERLAY,
            '/opt/salemax/releases/call-center-sip-endpoint-revocation-93e0359c63fe-20261116/compose.call-center-inbound-lead-link.json')
        self.assertEqual(helper.RUNTIME_FILES, (
            'modules/platform/asterisk-config.js',
            'client/public/call-center/call-center.js',
            'client/public/call-center/index.html',
        ))
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        self.assertEqual(helper.HELPER_NAME, RELEASE.HELPER_NAME)
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-zoiper-mobile-settings')
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *parent.REQUIRED_OVERLAYS, RELEASE.ACTIVE_OVERLAY,
            '/opt/salemax/releases/pro-catalyst-short-handoff-codes-e6c954692356-20261117/compose.pro-catalyst-short-handoff-codes.json')
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(wrapper, parent, helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, files[-1])

        without_call_center = files[:]
        without_call_center = tuple(path for path in without_call_center if path != RELEASE.ACTIVE_OVERLAY)
        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(without_call_center)
        with self.assertRaisesRegex(RuntimeError, 'SIP credential revocation overlay is missing'):
            RELEASE.bind_active_compose_chain(wrapper, parent, helper, app)

    def test_stage_contains_only_committed_runtime_files_and_reviewed_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        _, _, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.SOURCE_RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
