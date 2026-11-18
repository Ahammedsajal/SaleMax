import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / 'zoiper-7network-sip-username-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_zoiper_sip_username_release_helper', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class Zoiper7NetworkSipUsernameReleaseHelperTest(unittest.TestCase):
    def test_release_is_bound_to_the_current_display_label_overlay_and_three_runtime_files(self):
        previous, wrapper, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(helper.RUNTIME_FILES, (
            'modules/platform/asterisk-config.js',
            'modules/platform/asterisk-call-control.js',
            'modules/platform/asterisk-ari-client.js',
        ))
        self.assertEqual(helper.EXPECTED_IMAGE, RELEASE.EXPECTED_IMAGE)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        self.assertEqual(helper.HELPER_NAME, RELEASE.HELPER_NAME)
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-zoiper-7network-sip-username')
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *wrapper.REQUIRED_OVERLAYS, RELEASE.REVOCATION_OVERLAY, RELEASE.ACTIVE_OVERLAY)
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(previous, wrapper, helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, files[-1])

        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(files[:-1])
        with self.assertRaisesRegex(RuntimeError, 'Compose tail changed'):
            RELEASE.bind_active_compose_chain(previous, wrapper, helper, app)

    def test_stage_contains_only_committed_runtime_files_and_the_reviewed_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        _, _, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
