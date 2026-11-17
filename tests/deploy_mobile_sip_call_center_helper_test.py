import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


HELPER_PATH = Path(__file__).parents[1] / 'deploy' / 'mobile-sip-call-center-release.py'
SPEC = importlib.util.spec_from_file_location('mobile_sip_release_helper', HELPER_PATH)
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class MobileSipReleaseHelperTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'opt' / 'salemax'
        self.shared = self.root / 'shared'
        self.shared.mkdir(parents=True, mode=0o700)
        self.previous_root = HELPER.ROOT
        HELPER.ROOT = self.root

    def tearDown(self):
        HELPER.ROOT = self.previous_root
        self.temp.cleanup()

    def snapshot(self, name, values):
        folder = self.shared / name
        folder.mkdir(mode=0o700)
        path = folder / 'compose-vars.json'
        path.write_text(json.dumps(values))
        path.chmod(0o600)
        return path

    def compose(self, content):
        path = Path(self.temp.name) / 'compose.yml'
        path.write_text(content)
        backup = Path(self.temp.name) / 'rollback'
        backup.mkdir(exist_ok=True, mode=0o700)
        return path, backup

    def test_resolves_only_required_keys_from_agreeing_private_snapshots(self):
        required = {'MOBILE_BASE_IMAGE': 'salemax-app:test', 'MOBILE_RUNTIME': '/opt/salemax/releases/runtime'}
        self.snapshot('rollback-one', required)
        self.snapshot('rollback-two', required)
        compose, backup = self.compose('image: ${MOBILE_BASE_IMAGE:?required}\nsource: ${MOBILE_RUNTIME:?required}\noptional: ${OPTIONAL:-safe}\n')

        environment = HELPER.compose_environment({'Config': {'Env': []}}, [str(compose)], [], backup)

        self.assertEqual(environment['MOBILE_BASE_IMAGE'], required['MOBILE_BASE_IMAGE'])
        self.assertEqual(environment['MOBILE_RUNTIME'], required['MOBILE_RUNTIME'])
        self.assertNotIn('OPTIONAL', environment)
        saved = json.loads((backup / 'compose-vars.json').read_text())
        self.assertEqual(saved, required)
        self.assertEqual((backup / 'compose-vars.json').stat().st_mode & 0o777, 0o600)

    def test_rejects_conflicting_private_snapshots_and_unresolved_required_variables(self):
        self.snapshot('rollback-one', {'MOBILE_BASE_IMAGE': 'salemax-app:old'})
        self.snapshot('rollback-two', {'MOBILE_BASE_IMAGE': 'salemax-app:new'})
        compose, backup = self.compose('image: ${MOBILE_BASE_IMAGE:?required}\n')

        with self.assertRaisesRegex(RuntimeError, 'snapshots disagree for: MOBILE_BASE_IMAGE'):
            HELPER.compose_environment({'Config': {'Env': []}}, [str(compose)], [], backup)

        HELPER.ROOT = Path(self.temp.name) / 'empty-root'
        (HELPER.ROOT / 'shared').mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError, 'unavailable: MOBILE_BASE_IMAGE'):
            HELPER.compose_environment({'Config': {'Env': []}}, [str(compose)], [], backup)

    def test_live_compose_verification_checks_image_bind_source_and_read_only_mode(self):
        source = str(Path(self.temp.name) / 'runtime.js')
        config = {'services': {'app': {'image': 'salemax-app:test', 'volumes': [
            {'type': 'bind', 'source': source, 'target': '/app/runtime.js', 'read_only': True},
        ]}}}
        app = {'Config': {'Image': 'salemax-app:test'}, 'Mounts': [
            {'Type': 'bind', 'Source': source, 'Destination': '/app/runtime.js', 'RW': False},
        ]}
        HELPER.verify_live_compose_app(app, config)

        app['Mounts'][0]['RW'] = True
        with self.assertRaisesRegex(RuntimeError, 'bind mount differs'):
            HELPER.verify_live_compose_app(app, config)


if __name__ == '__main__':
    unittest.main()
