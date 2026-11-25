# Production deployment record

## Retail Store Connections, local imports and customer directory — production, 25 November 2026

Source commit 30f63fce8bbd5ebbf5848d0c6913bb28f491d3cb is on main and contains the reviewed Retail source plus the release-helper and MariaDB collation fixes (PRs #180–#183).

The active app-only release is /opt/salemax/releases/retail-native-import-backfill-30f63fce8bbd-20261125T163628Z. Its Compose overlay is compose.retail-imports-customers.json and is the tail of the existing layered production chain. It is based on /opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104, with the prior Retail backfill overlay retained at /opt/salemax/releases/retail-native-import-backfill-84e4cb0b8af8-20261125T162628Z. The production app image remained sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667; no image rebuild occurred. The final Compose chain had 348 inputs and 329 app mounts. The app and database are healthy; the app has zero restarts. Six support containers remained unchanged.

Final mounted runtime SHA-256 values:

| Runtime file | SHA-256 |
| --- | --- |
| modules/platform/retail-connected-stores-worker.js | b52a0c6d28b420f8be46696d972bcee2f6a0aa569c41a1da9795a586502fae58 |
| modules/platform/retail-native-import-backfill.js | f16eeb4a24761a47bb9eb2a03a7cd8aeb13fdab82fe48962ede99f95d5384a80 |

The first source release rehearsal stopped before database backup, migration or app activation because the release helper looked for the staged SQL file in the runtime list instead of the verified tools list. This was fixed and merged as 84e4cb0b8af888caa6c46c366407428acf4a2e48. The first backfill run then committed one 25-product batch and stopped on a MariaDB collation mismatch before customers or orders were materialized. Source commit 30f63fce changed the source-ID hash comparison to ASCII binary collation, was released as a follow-up overlay and the same backfill resumed idempotently. The initial validation-aborted snapshot at /opt/salemax/shared/rollback-retail-native-import-backfill-6cd2ae85ecdf-20261125T161939Z contains metadata only and is not a restorable backup.

The bounded local-snapshot backfill completed against the one active, entitled Retail connection: 50 products, 0 variants, 50 customers and 50 orders materialized; 5,052 customer search-token rows; 0 failures; and 0 remaining pending source rows. Aggregate source totals were 50 products, 0 variants, 50 active customers and 50 orders. The authenticated Edge review showed Products & services with 50 products, 50 drafts and 0 published; Retail orders with 50 matching orders; and the Customers directory with 73 entries. Imported products deliberately remain drafts. One active store connection still has no verified credentials, so the worker returned credentials_required. No external provider request was made. Additional provider pages and post-snapshot records remain unverified until credentials are revalidated and sync is accepted.

Migration 20270213_retail_native_store_imports.sql was already checksum-applied. The isolated restore rehearsal skipped it and retained ledger total 183; production apply likewise applied zero migrations. No schema change was made by these app overlays.

Protected rollback snapshot: /opt/salemax/shared/rollback-retail-native-import-backfill-30f63fce8bbd-20261125T163628Z. Its logical backup SHA-256 is 473f1935700cd103f20272ab4be8f61259c5af5da85be640fda938a422ff5787. The restore rehearsal matched fingerprints across 315 tables and 138,283 insert statements (fingerprint 0628ef9e6931402e967622ab8570f3647adb1cc4508f6f3ca54a8459d3379d60). The earlier 84e4 overlay backup also restored and matched fingerprints across 315 tables. These are pre-completion snapshots; do not restore them over the newer imported products, customer or order writes.

Guarded app restore command, if a rollback is ever reviewed: sudo -n /opt/salemax/shared/with-production-lock.sh python3 /opt/salemax/releases/retail-native-import-backfill-30f63fce8bbd-20261125T163628Z/deploy/retail-imports-customers-release.py restore /opt/salemax/shared/rollback-retail-native-import-backfill-30f63fce8bbd-20261125T163628Z. The helper refuses rollback while adopted native Retail data exists; after backfill, use a compatible forward fix and do not restore an older database over newer customer writes.

Verification: /healthz, /user/login, /admin/login, /user?page=products-services, /user?page=retail-connected-stores and /user?page=retail-customers returned HTTP 200. Anonymous Retail connector, customer and order overview APIs returned HTTP 401. Signed-in Edge confirmed product, order and customer list counts. Database aggregate checks confirmed 50 native catalogue mappings, 50 distinct imported customers, 5,052 search-token hashes, 50 native imported orders and zero pending snapshot rows. The database and app remained healthy after backfill.

The installed release-retention helper dry-run found 3 eligible release directories and estimated 1,454,080 reclaimable bytes among 331 release directories; no cleanup was applied. Current Retail overlays and rollback snapshots remain retained.

Open gates: fresh WooCommerce credential verification and Shopify OAuth/protected-customer approval; provider pagination beyond saved snapshots; signed-in role and customer-detail acceptance; English/Arabic RTL, theme, responsive and PWA verification. The full 42-ticket upgrade remains in progress.
