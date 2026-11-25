import base64
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).parents[1]
HELPER_PATH = ROOT / 'deploy' / 'retail-reconciliation-release.py'
SPEC = importlib.util.spec_from_file_location('retail_reconciliation_release_helper', HELPER_PATH)
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class RetailPendingMigrationsHelperTest(unittest.TestCase):
    def test_pending_migration_payload_reads_migration_from_staged_tools(self):
        relative = 'database/migrations/20270213_retail_native_store_imports.sql'
        source = b'-- already reviewed migration artifact\n'
        with TemporaryDirectory() as temp:
            stage = Path(temp)
            migration = stage / relative
            migration.parent.mkdir(parents=True)
            migration.write_bytes(source)
            info = {
                'runtime': {'modules/platform/retail-connected-stores-worker.js': '0' * 64},
                'tools': {relative: HELPER.ops.sha(source)},
                'pending': [relative],
            }

            payload = HELPER.pending_migration_payload(info, stage)

        self.assertEqual(payload, {
            '20270213_retail_native_store_imports.sql': {
                'sha256': HELPER.ops.sha(source),
                'source': base64.b64encode(source).decode('ascii'),
            },
        })

    def test_pending_migration_must_be_in_the_verified_stage_manifest(self):
        with TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError, 'missing from staged artifacts'):
                HELPER.pending_migration_payload({
                    'runtime': {},
                    'tools': {},
                    'pending': ['database/migrations/unlisted.sql'],
                }, Path(temp))


if __name__ == '__main__':
    unittest.main()
