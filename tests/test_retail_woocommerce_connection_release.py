import hashlib
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'retail_woocommerce_connect_fix_release', ROOT / 'deploy/retail-woocommerce-connect-fix-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class RetailWooCommerceConnectionReleaseTests(unittest.TestCase):
    def test_router_patch_changes_only_the_verified_return(self):
        source = b'async function verify() {\n  return connection;\n}\n'
        expected = source.replace(b'  return connection;\n', b'  return true;\n')
        updated = release.prepare_live_router(
            source,
            expected_sha=hashlib.sha256(source).hexdigest(),
            expected_output_sha=hashlib.sha256(expected).hexdigest(),
        )
        self.assertEqual(updated, expected)

    def test_router_patch_fails_closed_for_an_unreviewed_preimage(self):
        with self.assertRaisesRegex(RuntimeError, 'preimage changed'):
            release.prepare_live_router(b'async function verify() { return somethingElse; }')

    def test_router_patch_requires_exactly_one_buggy_return(self):
        source = b'  return connection;\n  return connection;\n'
        with self.assertRaisesRegex(RuntimeError, 'one undefined connection return'):
            release.prepare_live_router(
                source,
                expected_sha=hashlib.sha256(source).hexdigest(),
                expected_output_sha=hashlib.sha256(source).hexdigest(),
            )


if __name__ == '__main__':
    unittest.main()
