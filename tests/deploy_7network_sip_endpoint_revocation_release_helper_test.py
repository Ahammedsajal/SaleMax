import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-sip-endpoint-revocation-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_sip_endpoint_revocation_release_helper', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class SevenNetworkSipEndpointRevocationReleaseHelperTest(unittest.TestCase):
    def test_release_is_bound_to_the_previous_live_call_center_overlays_and_exact_runtime_files(self):
        wrapper, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(RELEASE.REQUIRED_OVERLAYS, (
            '/opt/salemax/releases/call-center-dinstar-model-guard-4069c70da166-20261112/compose.call-center-inbound-lead-link.json',
            '/opt/salemax/releases/call-center-dinstar-labels-f22faf8a039e-20261116/compose.call-center-inbound-lead-link.json',
        ))
        self.assertEqual(helper.RUNTIME_FILES, RELEASE.SOURCE_RUNTIME_FILES)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        self.assertEqual(helper.HELPER_NAME, 'deploy/7network-sip-endpoint-revocation-release.py')
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-sip-endpoint-revocation')
        self.assertEqual(helper.RELEASE_DAY, '20261116')
        self.assertEqual(wrapper.REQUIRED_OVERLAYS, RELEASE.REQUIRED_OVERLAYS)

    def test_release_preserves_the_later_live_compose_tail_and_rejects_missing_call_center_overlays(self):
        wrapper, helper = RELEASE.load_helper(ROOT)
        tail = '/opt/salemax/releases/pro-catalyst-qatar-required-3a93aa8541a8-20261116/compose.pro-catalyst-qatar-required.json'
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *RELEASE.REQUIRED_OVERLAYS, tail)
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(wrapper, helper, app), files)
        self.assertEqual(helper.ACTIVE_OVERLAY, tail)

        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join((files[0], tail))
        with self.assertRaisesRegex(RuntimeError, 'Required Dinstar model guard overlay'):
            RELEASE.bind_active_compose_chain(wrapper, helper, app)

    def test_stage_contains_only_committed_runtime_files_and_the_reviewed_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        _, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.SOURCE_RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
