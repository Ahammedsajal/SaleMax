# Business WhatsApp alerts and daily reports

The existing invoice and receipt actions enqueue a business notification inside their financial transaction. A rollback therefore cannot leave an alert for a transaction that did not happen. QR sends happen later, without holding financial record locks.

## Recipients and events

| Event | Recipients |
| --- | --- |
| Invoice issued, including the existing PDF generator | Active main user/owner and managers |
| Unpaid installment reaches its due date | Customer, active main user/owner, and managers |
| Training payment confirmed and receipt issued | Customer, active main user/owner, and managers |
| Sales receipt recorded | Main user/owner and managers; customer notification follows when the receipt is allocated to an identified invoice |
| Daily business report | Active main user/owner only |

The tenant's single active main-user QR connection is the default. If unavailable, a single eligible manager connection can be used. Multiple connections require an explicit `qr_instance_id` in `sx_business_notification_settings`; an ambiguous sender is blocked. Staff recipients come from active memberships and their owned legacy accounts. Customer numbers come from the invoice's tenant-bound customer context. Qatar local numbers are normalized only when the tenant's timezone is Asia/Qatar. Missing numbers are recorded as blocked, rather than substituted with another person's number.

Invoice issue is deduplicated between a generated document and its posted invoice. Customer due reminders respect disabled tenant reminders and an explicit customer reminder opt-out, and recheck unpaid installments, invoice/enrollment cancellation, open disputes, recipient number, and date. Unverified payments do not generate confirmed receipts. Existing historical invoice/receipt events are not backfilled. New due-date notices operate on current unpaid balances. Tenant scans use keyset batches so accounts beyond the first batch are not silently omitted.

## Delivery and reports

`SALEMAX_BUSINESS_NOTIFICATIONS_ENABLED=true` starts the in-app queue worker. `LOCAL_ONLY_MODE=true` disables external sending. The worker scans schedules every minute and drains notifications every 15 seconds. Tenant settings can disable the worker or daily summary and select a QR instance. New daily summaries default to 19:00 in the tenant timezone (Asia/Qatar when not set). Daily WhatsApp summaries are restricted to the current active owner profile phone at enqueue and again at dispatch; verified staff or report-recipient rows cannot widen the recipient list.

The report shows daily activity first and month-to-date activity below it: new leads, leads with an issued invoice, applications, invoice count and amounts, and confirmed receipts. It excludes chat totals and pipeline counts. Receivables and overdue balances are highlighted separately by currency, with overdue aging in 1–30, 31–60, 61–90, and over-90-day buckets. Receivables reuse the Finance dashboard invoice projection, subtract allocated receipts and posted credits, and exclude archived/replaced PDFs and generated documents already linked to posted invoices. Activity is counted through the report cutoff in the tenant timezone. The A4 PDF filename is `<business>_sale_summary_report.pdf` and follows the owner-only summary text.

Each event/destination/part has a unique delivery record. Text and PDF have independent provider acknowledgements. Expired or uncertain provider sends are marked `unknown` for review and are never automatically resent. Known pre-send/configuration failures back off, with a bounded attempt count. Provider acceptance does not establish recipient delivery or read confirmation. Staff identity and membership, customer destination, and plan entitlements are rechecked at dispatch.

## Verification and operations

- Focused behavior tests: `node --test tests/business-notifications.test.js`.
- Disposable MariaDB integration: set `BUSINESS_TEST_DB_SOCKET` to an isolated MariaDB socket, then run `node tests/business-notifications-database.integration.cjs`. This requires a disposable root account and creates/drops only a random synthetic schema.
- Explicit test sends: `node scripts/send-business-notification-samples.cjs --tenant-id <training-center-uuid> --to <international-number> --confirm-test-send`. This sends three clearly marked synthetic finance messages plus a test delivery of the tenant's current aggregate daily text/PDF. It does not create invoices, payments, or customer records, alter production recipients, or drain historical alerts. Run only with an explicitly authorized destination.
- Inspect `sx_business_notification_events` and `sx_business_notification_deliveries` for blocked/unknown/failed attempts. Do not reset uncertain sends to queued without checking the provider outcome.
- Runtime PDF dependencies are pinned under `deploy/pdf-runtime`; ordinary source builds also use the main `package-lock.json`. The internal PDF endpoint accepts bounded PDF bytes only behind the existing internal authentication and validates ownership of the active QR sender.

Every deployment uses `skills/7network-production-change/SKILL.md` and is recorded in `DEPLOYMENT.md` with the exact runtime overlays, migration, image, rollback snapshot, hashes, and remaining acceptance gates. The full application upgrade remains tracked separately.
