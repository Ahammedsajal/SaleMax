import importlib.util
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / 'asterisk-ari-7network-mobile-object-ids-release.py'
SPEC = importlib.util.spec_from_file_location('asterisk_ari_7network_mobile_object_ids_release', HELPER_PATH)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class AsteriskAri7NetworkMobileObjectIdsReleaseHelperTest(unittest.TestCase):
    def test_release_is_bound_to_the_active_zoiper_overlay_and_one_runtime_file(self):
        _base, _wrapper, helper = RELEASE.load_helper(ROOT)
        self.assertEqual(helper.RUNTIME_FILES, ('modules/platform/asterisk-ari-client.js',))
        self.assertEqual(helper.EXPECTED_IMAGE, RELEASE.EXPECTED_IMAGE)
        self.assertEqual(helper.EXPECTED_PREIMAGES, RELEASE.EXPECTED_PREIMAGES)
        self.assertEqual(helper.HELPER_NAME, RELEASE.HELPER_NAME)
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-ari-7network-mobile-object-ids')
        files = ('/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *RELEASE.REQUIRED_OVERLAYS)
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join(files)}}}
        self.assertEqual(RELEASE.bind_active_compose_chain(*RELEASE.load_helper(ROOT), app), files)

        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(files[:-1])
        with self.assertRaisesRegex(RuntimeError, 'Compose chain is missing'):
            RELEASE.bind_active_compose_chain(*RELEASE.load_helper(ROOT), app)

        changed = (*files, '/opt/salemax/releases/unreviewed/compose.json')
        app['Config']['Labels']['com.docker.compose.project.config_files'] = ','.join(changed)
        with self.assertRaisesRegex(RuntimeError, 'Compose tail changed'):
            RELEASE.bind_active_compose_chain(*RELEASE.load_helper(ROOT), app)

    def test_stage_contains_only_the_committed_ari_client_and_reviewed_helper(self):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
            capture_output=True, text=True).stdout.strip()
        _base, _wrapper, helper = RELEASE.load_helper(ROOT)
        with TemporaryDirectory() as temp:
            stage = Path(temp) / 'stage'
            helper.prepare_stage(ROOT, stage, commit)
            manifest = helper.validate_stage(stage, commit)
            self.assertEqual(set(manifest['files']), set(RELEASE.RUNTIME_FILES) | {RELEASE.HELPER_NAME})
            self.assertEqual(manifest['sourceCommit'], commit)


if __name__ == '__main__':
    unittest.main()
