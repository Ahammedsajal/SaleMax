# Finance Reports dashboard

Finance Reports opens `/user?page=finance-settings&section=reports` inside the existing business workspace. Invoices & Payments retains its existing screen.

- Today, Monday-to-today, month-to-today, all-time and manual date ranges use Qatar dates. Sales use invoice issue dates; receipts use received dates. Balances and aging are current balances of the selected invoice cohort, rather than historical closing balances.
- Sales include active generated documents and issued posted invoices. A generated document linked to a posted invoice counts once. Archived/replaced generated documents and void invoices are excluded.
- Receipt totals include posted payments with an issued receipt. Pending verification never reduces receivables. Applied amounts, allocation reversals and approved credits determine the remaining invoice balance. Excess deposits are not subtracted twice. Existing payment attribution continues to credit the original sales agent and reverse credit for completed refunds and lost chargebacks.
- Aging uses unpaid installment amounts with due dates before today. Generated schedules participate until posting. Cards, aging buckets and monthly chart bars open paginated details, linked to invoices, receipts, leads, students, sales and applications where those records exist.
- Managers can read finance reports/documents. Invoice creation/editing, payment verification and scheduling retain their existing write restrictions.

## Account-controlled daily reporting

Each owner configures their own recipients and daily send time on Finance Reports. Recipients use existing Business Profile records and 10-digit challenge verification. New schedules default to paused, with 23:59 Qatar time suggested. Deployment creates no recipients or schedules.

QR delivery uses the existing protected internal QR endpoint. It revalidates active tenant, owner mapping, exactly one active QR sender and verified tenant recipient before sending. Ambiguous senders are refused. Acceptance requires a provider message ID; unknown send outcomes are not automatically resent. Existing durable report scheduling and delivery ledgers are reused.

Runtime settings belong in the protected server runtime file, never Git:

- SALEMAX_REPORT_WHATSAPP_TRANSPORT=qr
- SALEMAX_REPORT_WHATSAPP_ENABLED=true
- SALEMAX_REPORT_DELIVERY_ENABLED=true
- SALEMAX_TRAINING_REPORT_WORKER_ENABLED=true for the worker
- SALEMAX_REPORT_QR_INTERNAL_ORIGIN=http://app:3010 for Docker; loopback is the default for a shared process host
- Strong external CRM_INTERNAL_SECRET and SALEMAX_REPORT_VERIFICATION_KEY shared by app and worker

Sending additionally requires an owner-activated schedule, verified recipient and connected sender. Meta template transport remains available when QR transport is not selected. LOCAL_ONLY_MODE=true disables QR delivery.

## Verification

Disposable MariaDB integration checks deduplication, archive/replacement exclusion, partial payments, pending exclusion, reversals, credits, aging amounts, receipt/application linkage, charts, pagination, tenant isolation and Qatar midnight boundaries. Synthetic browser checks cover English/Arabic desktop and 390px/260px layouts, cards, presets, invoice/receipt opening, aging, pagination and recipient verification. Provider mocks check sender/recipient boundaries and unknown outcomes; these are separate from real WhatsApp acceptance.
