import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


HELPER_PATH = Path(__file__).parents[1] / 'deploy' / 'call-center-inbound-lead-link-release.py'
SPEC = importlib.util.spec_from_file_location('call_center_inbound_lead_link_release_helper', HELPER_PATH)
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class CallCenterInboundLeadLinkReleaseHelperTest(unittest.TestCase):
    def make_stage(self, root, commit):
        stage = root / 'stage'
        stage.mkdir(mode=0o700)
        files = {}
        for name in HELPER.RUNTIME_FILES:
            data = ('runtime:' + name).encode()
            path = stage / 'runtime' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            files[name] = HELPER.sha(data)
        helper_name = Path(HELPER.HELPER_NAME).name
        helper_data = b'helper'
        (stage / 'deploy').mkdir()
        (stage / 'deploy' / helper_name).write_bytes(helper_data)
        files[HELPER.HELPER_NAME] = HELPER.sha(helper_data)
        (stage / 'manifest.json').write_text(json.dumps({'sourceCommit': commit, 'files': files}))
        return stage

    def test_stage_requires_exact_files_and_hashes_for_the_source_commit(self):
        commit = 'a' * 40
        with tempfile.TemporaryDirectory() as temp:
            stage = self.make_stage(Path(temp), commit)
            self.assertEqual(HELPER.validate_stage(stage, commit)['sourceCommit'], commit)
            runtime = stage / 'runtime' / HELPER.RUNTIME_FILES[0]
            runtime.write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError, 'Staged source hash mismatch'):
                HELPER.validate_stage(stage, commit)
            with self.assertRaisesRegex(RuntimeError, 'Stage manifest differs'):
                HELPER.validate_stage(stage, 'b' * 40)

    def test_qatar_answer_fallback_overlay_starts_from_the_live_qatar_dial_release(self):
        self.assertEqual(HELPER.ACTIVE_OVERLAY,
            '/opt/salemax/releases/call-center-qatar-local-dial-dda3adaf1e67-20261112/compose.call-center-inbound-lead-link.json')
        runtime_file = 'modules/platform/asterisk-call-control.js'
        self.assertEqual(HELPER.RUNTIME_FILES, (runtime_file,))
        self.assertEqual(HELPER.EXPECTED_PREIMAGES, {
            runtime_file: 'e7b5d97e65e1fee0cab51f130c593e87feedb8ebcd0a0c2099d6f5e2b9f145fa',
        })
        self.assertEqual(HELPER.RELEASE_PREFIX, 'call-center-qatar-inbound-fallback')

    def test_mount_overlay_replaces_only_the_reviewed_files(self):
        previous = {'services': {'app': {'image': 'app:test', 'command': ['node', 'server.js'], 'volumes': [
            {'type': 'bind', 'source': '/old/call-control.js', 'target': '/app/modules/platform/asterisk-call-control.js', 'read_only': True},
            {'type': 'bind', 'source': '/keep/site.js', 'target': '/app/client/public/site.js', 'read_only': True},
        ]}}}
        mounts = [
            {'type': 'bind', 'source': '/new/ari-client.js', 'target': '/app/modules/platform/asterisk-ari-client.js', 'read_only': True},
            {'type': 'bind', 'source': '/new/call-control.js', 'target': '/app/modules/platform/asterisk-call-control.js', 'read_only': True},
        ]
        candidate = {'services': {'app': {'image': 'app:test', 'command': ['node', 'server.js'], 'volumes': [
            previous['services']['app']['volumes'][1], mounts[0], mounts[1],
        ]}}}
        HELPER.validate_mount_overlay(previous, candidate, mounts)

        unsafe = json.loads(json.dumps(candidate))
        unsafe['services']['app']['command'] = ['node', 'different.js']
        with self.assertRaisesRegex(RuntimeError, 'non-mount Compose configuration'):
            HELPER.validate_mount_overlay(previous, unsafe, mounts)

    def test_runtime_materialization_includes_configured_files_without_preimages(self):
        commit = 'c' * 40
        original_runtime_files = HELPER.RUNTIME_FILES
        new_file = 'modules/platform/new-runtime-module.js'
        HELPER.RUNTIME_FILES = (*original_runtime_files, new_file)
        with tempfile.TemporaryDirectory() as temp:
            try:
                root = Path(temp)
                stage = self.make_stage(root, commit)
                runtime = root / 'release' / 'runtime'
                runtime.mkdir(parents=True)
                content = HELPER.materialize_runtime_files(stage, runtime)
                self.assertEqual(set(content), set(HELPER.RUNTIME_FILES))
                self.assertIn(new_file, content)
                self.assertEqual((runtime / new_file).read_bytes(), b'runtime:' + new_file.encode())
                self.assertEqual((runtime / new_file).stat().st_mode & 0o777, 0o644)
            finally:
                HELPER.RUNTIME_FILES = original_runtime_files

    def test_live_compose_validation_requires_the_running_image_and_every_bind_mount_to_match(self):
        app = {
            'Config': {'Image': 'app:test'},
            'Mounts': [{'Type': 'bind', 'Destination': '/app/file.js', 'Source': '/release/file.js', 'RW': False}],
        }
        config = {'services': {'app': {'image': 'app:test', 'volumes': [
            {'type': 'bind', 'target': '/app/file.js', 'source': '/release/file.js', 'read_only': True},
        ]}}}
        HELPER.verify_live_compose_app(app, config)

        wrong_image = json.loads(json.dumps(config))
        wrong_image['services']['app']['image'] = 'app:other'
        with self.assertRaisesRegex(RuntimeError, 'image differs'):
            HELPER.verify_live_compose_app(app, wrong_image)

        wrong_mount = json.loads(json.dumps(config))
        wrong_mount['services']['app']['volumes'][0]['source'] = '/other/file.js'
        with self.assertRaisesRegex(RuntimeError, 'bind mount differs'):
            HELPER.verify_live_compose_app(app, wrong_mount)


if __name__ == '__main__':
    unittest.main()
