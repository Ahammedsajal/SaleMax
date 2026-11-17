import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-zoiper-push-registration-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_zoiper_push_registration_release', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class SevenNetworkZoiperPushRegistrationReleaseHelperTest(unittest.TestCase):
    def test_release_preserves_the_current_stack_and_requires_credential_revision_overlay(self):
        previous, aor, endpoint, outbound, zoiper, wrapper, parent, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(helper.RUNTIME_FILES, RELEASE.RUNTIME_FILES)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        tail = '/opt/salemax/releases/example-newer-app-overlay/compose.example.json'
        files = (
            '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *wrapper.REQUIRED_OVERLAYS,
            zoiper.ACTIVE_OVERLAY,
            outbound.ACTIVE_OVERLAY,
            endpoint.ACTIVE_OVERLAY,
            aor.ACTIVE_OVERLAY,
            previous.ACTIVE_OVERLAY,
            RELEASE.ACTIVE_OVERLAY,
            tail,
        )
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(previous, aor, endpoint, outbound, zoiper, wrapper, parent,
            helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, tail,
            'append after the current credential overlay and preserve any newer unrelated app overlays')

        without_credential = tuple(path for path in files if path != RELEASE.ACTIVE_OVERLAY)
        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(without_credential)
        with self.assertRaisesRegex(RuntimeError, 'active Zoiper credential revision overlay is missing'):
            RELEASE.bind_active_compose_chain(previous, aor, endpoint, outbound, zoiper, wrapper, parent, helper, app)

    def test_stage_contains_only_the_reviewed_runtime_file_and_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        *_, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
