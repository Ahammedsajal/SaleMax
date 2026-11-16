import importlib.util
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / '7network-dinstar-labels-release.py'
SPEC = importlib.util.spec_from_file_location('seven_network_dinstar_labels_release_helper', HELPER_PATH)
WRAPPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WRAPPER)


class SevenNetworkDinstarLabelsReleaseHelperTest(unittest.TestCase):
    def test_helper_is_bound_to_current_overlay_and_exact_runtime_files(self):
        helper = WRAPPER.load_helper(ROOT)
        self.assertIsNone(helper.ACTIVE_OVERLAY)
        self.assertEqual(WRAPPER.REQUIRED_OVERLAYS, (
            '/opt/salemax/releases/call-center-dinstar-model-guard-4069c70da166-20261112/compose.call-center-inbound-lead-link.json',
        ))
        self.assertEqual(str(helper.ACTIVE_HELPER),
            '/opt/salemax/releases/call-center-qatar-inbound-fallback-207a2f5a845b-20261112/deploy/call-center-inbound-lead-link-release.py')
        self.assertEqual(helper.RUNTIME_FILES, (
            'modules/platform/call-center-router.js',
            'modules/platform/tenant-asterisk-gateways.js',
            'client/public/admin-telephony.js',
            'client/public/call-center/index.html',
        ))
        self.assertEqual(WRAPPER.INDEX_FILE, 'client/public/index.html')
        self.assertEqual(WRAPPER.SOURCE_RUNTIME_FILES, helper.RUNTIME_FILES)
        self.assertEqual(WRAPPER.SOURCE_RUNTIME_FILES + (WRAPPER.INDEX_FILE,), (
            'modules/platform/call-center-router.js',
            'modules/platform/tenant-asterisk-gateways.js',
            'client/public/admin-telephony.js',
            'client/public/call-center/index.html',
            'client/public/index.html',
        ))
        self.assertEqual(helper.EXPECTED_PREIMAGES, {
            'modules/platform/call-center-router.js': '59badc7dbfbe77dc2e570ed9a0f4d3843fafe431b5a631ee9f8d1ff6011f682a',
            'modules/platform/tenant-asterisk-gateways.js': '30409f1c765e2ea4c7841335595f1155119aae7dc3689a39ba2df02acd831b1b',
            'client/public/admin-telephony.js': '649852f14abcc3fa54ed59fddfbe68f2178979685ca6047a9dfddf7b4d52e038',
            'client/public/call-center/index.html': 'a6a1140474b7a6b528aa9cf05e41d56fe35841e37fd9ecfec64c3f4c3efd78b8',
            'client/public/index.html': '72d89f9ad115a7a2c9eceab3e189319d76731c07b348bbb9e8c400226c03984d',
        })
        self.assertEqual(helper.RELEASE_PREFIX, 'call-center-dinstar-labels')
        self.assertEqual(helper.RELEASE_DAY, '20261116')
        self.assertEqual(helper.HELPER_NAME, 'deploy/7network-dinstar-labels-release.py')

    def test_deploy_binds_the_current_live_compose_tail_and_requires_model_guard(self):
        helper = WRAPPER.load_helper(ROOT)
        tail = '/opt/salemax/releases/pro-catalyst-course-context-b836d27e1c6c-20261116/compose.pro-catalyst-course-context.json'
        app = {'Config': {'Labels': {'com.docker.compose.project.config_files': ','.join((
            '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104/deploy/compose.yml',
            *WRAPPER.REQUIRED_OVERLAYS,
            tail,
        ))}}}
        files = WRAPPER.bind_active_compose_chain(helper, app)
        self.assertEqual(files[-1], tail)
        self.assertEqual(helper.ACTIVE_OVERLAY, tail)

        app['Config']['Labels']['com.docker.compose.project.config_files'] = tail
        with self.assertRaisesRegex(RuntimeError, 'Required Dinstar model guard overlay'):
            WRAPPER.bind_active_compose_chain(helper, app)

    def test_live_index_patch_changes_only_one_exact_cache_busted_asset(self):
        original = b'<script src="/admin-telephony.js?v=20261012-tls-readonly2"></script>\n<section>live shell</section>\n'
        expected = hashlib.sha256(original).hexdigest()
        patched = WRAPPER.patch_admin_telephony_index(original, expected)
        self.assertEqual(patched,
            b'<script src="/admin-telephony.js?v=20261116-dinstar-model-caveat1"></script>\n<section>live shell</section>\n')
        with self.assertRaises(RuntimeError):
            WRAPPER.patch_admin_telephony_index(original, '0' * 64)

        duplicate = original + original
        with self.assertRaises(RuntimeError):
            WRAPPER.patch_admin_telephony_index(duplicate, hashlib.sha256(duplicate).hexdigest())

    def test_deploy_stage_derives_the_shell_from_the_verified_live_file(self):
        commit = 'a' * 40
        live_index = b'<script src="/admin-telephony.js?v=20261012-tls-readonly2"></script>\n<section>latest shell</section>\n'
        live_hash = hashlib.sha256(live_index).hexdigest()
        helper = WRAPPER.load_helper(ROOT)
        helper.APP = 'test-app'
        expected = helper.EXPECTED_PREIMAGES[WRAPPER.INDEX_FILE]
        helper.EXPECTED_PREIMAGES[WRAPPER.INDEX_FILE] = live_hash
        try:
            with TemporaryDirectory() as temp:
                stage = Path(temp)
                manifest = {
                    'sourceCommit': commit,
                    'files': {name: '0' * 64 for name in WRAPPER.SOURCE_RUNTIME_FILES},
                }
                manifest['files'][WRAPPER.HELPER_NAME] = '1' * 64
                (stage / 'manifest.json').write_text(json.dumps(manifest))
                with patch.object(WRAPPER.subprocess, 'run', return_value=SimpleNamespace(stdout=live_index)):
                    WRAPPER.prepare_live_index(helper, stage, commit)

                output = (stage / 'runtime' / WRAPPER.INDEX_FILE).read_bytes()
                self.assertEqual(output,
                    b'<script src="/admin-telephony.js?v=20261116-dinstar-model-caveat1"></script>\n<section>latest shell</section>\n')
                updated = json.loads((stage / 'manifest.json').read_text())
                self.assertEqual(updated['files'][WRAPPER.INDEX_FILE], hashlib.sha256(output).hexdigest())
                self.assertEqual(updated['liveDerivedFiles'][WRAPPER.INDEX_FILE]['preimageSha256'], live_hash)
        finally:
            helper.EXPECTED_PREIMAGES[WRAPPER.INDEX_FILE] = expected


if __name__ == '__main__':
    unittest.main()
