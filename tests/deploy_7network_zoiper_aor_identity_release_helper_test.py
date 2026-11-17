import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-zoiper-aor-identity-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_zoiper_aor_identity_release', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class SevenNetworkZoiperAorIdentityReleaseHelperTest(unittest.TestCase):
    def test_release_preserves_the_active_callcenter_chain_and_runtime_scope(self):
        previous, outbound, zoiper, wrapper, parent, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(helper.RUNTIME_FILES, RELEASE.RUNTIME_FILES)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        email_overlay = '/opt/salemax/releases/email-marketing-navigation-e46637cd1555-20261117T120446Z/compose.email-marketing-navigation.json'
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *wrapper.REQUIRED_OVERLAYS, zoiper.ACTIVE_OVERLAY, outbound.ACTIVE_OVERLAY,
            previous.ACTIVE_OVERLAY, RELEASE.ACTIVE_OVERLAY, email_overlay)
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(previous, outbound, zoiper, wrapper, parent, helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, email_overlay,
            'the AoR fix must append after and preserve the current Email Marketing overlay')

        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(files[:-2] + (email_overlay,))
        with self.assertRaisesRegex(RuntimeError, 'active Zoiper endpoint-identity overlay is missing'):
            RELEASE.bind_active_compose_chain(previous, outbound, zoiper, wrapper, parent, helper, app)

    def test_stage_contains_only_the_reviewed_asterisk_config_and_release_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        _, _, _, _, _, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
