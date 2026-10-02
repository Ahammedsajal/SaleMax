# SaleMaX finance contract foundation (TC39)

This is the executable arithmetic and posting-readiness contract for training-center finance. Tenant policy drafts, review and accountant decisions are persisted through the existing `/user` Finance settings screen and the APIs documented in `API_DOCUMENTATION.md`. The implemented sale-conversion transaction issues an immutable invoice and initial receivable journal. The manual-payment transaction records pending payments, posts verified allocations and balanced journals, updates invoice balances and issues one tenant-scoped receipt per posted payment. Credits, refunds, revenue recognition, customer documents and provider delivery remain incomplete, so end-to-end finance release readiness is still false.

## Core balance rules

All money is represented as integer minor units; the Qatar release uses QAR and 100 dirhams per riyal. Floating-point arithmetic is rejected. Currency conversion and cross-currency allocations are outside this first-release contract.

- Invoice open balance = issued gross − posted credits + credit reversals − posted allocations + allocation reversals. The result must remain between zero and issued gross.
- Payment funds available = gross receipt − completed refunds + refund reversals − chargebacks + chargeback reversals − allocations + allocation reversals. A pending refund does not reduce cash. The result cannot be negative or exceed net funds.
- Installment amounts must be positive integer minor units, have valid calendar due dates, contain no more than 12 entries, and sum exactly to the issued invoice total.
- Each journal entry contains at least two single-sided lines in one ISO currency; debit and credit totals must be nonzero and equal.
- Cumulative recognized revenue cannot exceed approved eligible net course consideration. Collection alone does not establish revenue recognition.

## Posting-readiness gate

`modules/platform/finance-contract.js` exposes a pure policy completeness/readiness check. A complete profile requires Qatar jurisdiction, QAR, legal entity name, invoice prefix, explicit tax mode and rate where applicable, revenue method, invoice approver, and an authenticated accountant approval record. Missing/invalid values return stable blocker codes. Tax values, legal invoice identity and revenue treatment are deliberately not inferred from the country selection. The API separately reports `policyReady`; remaining finance domains continue to block full transaction readiness even though conversion and manual payment posting are implemented.

The `invoiceBalance`, `paymentBalance`, `assertInstallments`, `assertBalancedJournal`, and `assertRecognition` functions implement the invariant calculations and fail with stable error codes. They are reusable by transactional APIs and synthetic reconciliation; they are not public HTTP APIs. The implemented credit-note transaction includes posted credits in the same invoice balance invariant and allocates each credit to remaining installment receivables without editing invoices, payments or receipts.

## Synthetic reconciliation baseline

The plan's QAR 3,000 example is expressed in 300,000 minor units. Issuing a three-installment invoice begins at 300,000 receivable. Posting a 100,000 payment allocation leaves 200,000 open; a duplicate provider event must be rejected by the later idempotent posting layer, not counted twice here. A subsequent 50,000 credit leaves 150,000 open after the first payment. The payment receipt remains 100,000 even though the invoice balance is 150,000. These distinct values are intentional: invoice debt, cash received, and receipt total are not interchangeable. The current MariaDB transaction integration also verifies partial payment followed by an excess payment: 185,000 is allocated, 15,000 remains a customer deposit, and the second receipt remains 200,000.

Unit and synthetic MariaDB tests cover partial allocation, finance-policy accountant-only approval, exact installments, invalid calendar dates, balanced and unbalanced journals, revenue caps, policy draft revision, completeness gating, retry idempotency, and retention of the previously approved policy while a replacement is drafted. The current integration suite additionally verifies idempotent concurrent payment verification, a single immutable receipt, balanced payment journals, duplicate-reference warnings, pending-versus-posted balances, excess deposits, tenant denial, approved/rejected credit notes and credit-adjusted allocation. Authenticated English/Arabic browser acceptance, accountant onboarding, proof documents, PDF generation, customer delivery, cash refund/reversal/chargeback transactions and broader reconciliation remain required before the finance release is complete.

## Invoice credit notes (TC20 in progress)

An approved credit reduces only outstanding receivable: `open = issued gross - posted credit notes - posted allocations`. A request is an immutable pending record with an idempotency key and reason; review must be performed by an owner or accountant identity distinct from the requester. Posting rechecks the tenant/invoice and balance under transaction locks, distributes the credit over unpaid installment balances, preserves paid amounts, numbers the credit note and posts balanced sales-returns / accounts-receivable lines. It records audit and outbox events in the same transaction. An unresolved manual payment blocks credit approval so the decision cannot race payment verification. Credits do not move cash; refunds, reversals and chargebacks must remain separate immutable events. Cross-tenant reads/writes return not-found or denial, and the invoice/detail register only counts posted credits. An installment settled by a combination of payment and credit has `settled` status, while a fully credited installment has `credited` status.


## Versioned installment schedule changes (TC17)

Schedule edits affect only future, wholly unpaid installments. Paid, partly paid, due and overdue rows are retained. The proposed replacement total must match the existing eligible amount exactly and dates must be strictly increasing and future in Asia/Qatar. A distinct owner/accountant identity must approve; approval keeps old rows cancelled for history and appends a new schedule version. A pending payment or stale base version blocks a change. The transaction queues inance.installment.schedule-changed; because no reminder consumer is active, reminder cancellation/recalculation is still unimplemented.
