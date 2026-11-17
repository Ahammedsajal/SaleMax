import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


HELPER_PATH = Path(__file__).parents[1] / 'deploy' / 'call-center-ringback-release.py'
SPEC = importlib.util.spec_from_file_location('call_center_ringback_release_helper', HELPER_PATH)
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class CallCenterRingbackReleaseHelperTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
