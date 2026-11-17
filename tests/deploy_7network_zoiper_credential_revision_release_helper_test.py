import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-zoiper-credential-revision-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_zoiper_credential_revision_release', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class SevenNetworkZoiperCredentialRevisionReleaseHelperTest(unittest.TestCase):
    def test_release_preserves_the_current_stack_and_requires_the_aor_fix(self):
        previous, endpoint, outbound, zoiper, wrapper, parent, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(helper.RUNTIME_FILES, RELEASE.RUNTIME_FILES)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        tail = '/opt/salemax/releases/email-marketing-test-recipient-e6dc92135195-20261117T130902Z/compose.email-marketing-test-recipient.json'
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *wrapper.REQUIRED_OVERLAYS, zoiper.ACTIVE_OVERLAY, outbound.ACTIVE_OVERLAY,
            endpoint.ACTIVE_OVERLAY, previous.ACTIVE_OVERLAY, RELEASE.ACTIVE_OVERLAY, tail)
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(previous, endpoint, outbound, zoiper, wrapper, parent, helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, tail,
            'the credential revision release must append after, and preserve, unrelated active overlays')

        without_aor = tuple(path for path in files if path != RELEASE.ACTIVE_OVERLAY)
        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(without_aor)
        with self.assertRaisesRegex(RuntimeError, 'active Zoiper AoR identity overlay is missing'):
            RELEASE.bind_active_compose_chain(previous, endpoint, outbound, zoiper, wrapper, parent, helper, app)

    def test_stage_contains_only_the_six_reviewed_runtime_files_and_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        _, _, _, _, _, _, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
