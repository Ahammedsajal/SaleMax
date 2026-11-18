import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / 'zoiper-7network-display-label-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_zoiper_display_label_release_helper', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class Zoiper7NetworkDisplayLabelReleaseHelperTest(unittest.TestCase):
    def test_release_is_bound_to_current_production_tail_and_two_reviewed_files(self):
        previous, wrapper, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(helper.RUNTIME_FILES, (
            'client/public/call-center/call-center.js',
            'client/public/call-center/index.html',
        ))
        self.assertEqual(helper.EXPECTED_IMAGE, RELEASE.EXPECTED_IMAGE)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        self.assertEqual(helper.HELPER_NAME, RELEASE.HELPER_NAME)
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-zoiper-7network-label')
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *wrapper.REQUIRED_OVERLAYS, RELEASE.REVOCATION_OVERLAY,
            '/opt/salemax/releases/call-center-zoiper-push-registration-b810dcf2d1da-20261117/compose.call-center-inbound-lead-link.json',
            '/opt/salemax/releases/email-marketing-inbox-9c500374b367-20261117T142950Z/compose.email-marketing-inbox.json',
            RELEASE.ACTIVE_OVERLAY)
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(previous, wrapper, helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, files[-1])

        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(files[:-1])
        with self.assertRaisesRegex(RuntimeError, 'Compose tail changed'):
            RELEASE.bind_active_compose_chain(previous, wrapper, helper, app)

    def test_stage_contains_only_committed_runtime_files_and_reviewed_helper(self):
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
