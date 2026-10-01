# SaleMaX finance contract foundation (TC39)

This is the executable arithmetic and readiness contract for the training-center finance work. It does not issue invoices, post payments, create journal entries, or configure a tenant. Posting remains disabled until an accountant-approved tenant policy and the transactional finance modules are implemented.

## Core balance rules

All money is represented as integer minor units; the Qatar release uses QAR and 100 dirhams per riyal. Floating-point arithmetic is rejected. Currency conversion and cross-currency allocations are outside this first-release contract.

- Invoice open balance = issued gross − posted credits + credit reversals − posted allocations + allocation reversals. The result must remain between zero and issued gross.
- Payment funds available = gross receipt − completed refunds + refund reversals − chargebacks + chargeback reversals − allocations + allocation reversals. A pending refund does not reduce cash. The result cannot be negative or exceed net funds.
- Installment amounts must be positive integer minor units, have valid calendar due dates, contain no more than 12 entries, and sum exactly to the issued invoice total.
- Each journal entry contains at least two single-sided lines in one ISO currency; debit and credit totals must be nonzero and equal.
- Cumulative recognized revenue cannot exceed approved eligible net course consideration. Collection alone does not establish revenue recognition.

## Posting-readiness gate

`modules/platform/finance-contract.js` exposes a pure `postingReadiness` check. Posting requires an approved profile with Qatar jurisdiction, QAR, legal entity name, invoice prefix, explicit tax mode and rate where applicable, revenue method, invoice approver, and an authenticated accountant approval record. Missing/invalid values return stable blocker codes. Tax values, legal invoice identity and revenue treatment are deliberately not inferred from the country selection.

The `invoiceBalance`, `paymentBalance`, `assertInstallments`, `assertBalancedJournal`, and `assertRecognition` functions implement the invariant calculations and fail with stable error codes. They are reusable by the upcoming transactional APIs and synthetic reconciliation suite; they are not public HTTP APIs.

## Synthetic reconciliation baseline

The plan's QAR 3,000 example is expressed in 300,000 minor units. Issuing a three-installment invoice begins at 300,000 receivable. Posting a 100,000 payment allocation leaves 200,000 open; a duplicate provider event must be rejected by the later idempotent posting layer, not counted twice here. A subsequent 50,000 credit leaves 150,000 open after the first payment. The payment receipt remains 100,000 even though the invoice balance is 150,000. These distinct values are intentional: invoice debt, cash received, and receipt total are not interchangeable.

Automated tests cover partial allocation, credits, reversals, partial refund/chargeback, exact installments, invalid calendar dates, balanced and unbalanced journals, revenue caps, and missing/unapproved Qatar policy. Database locking, unique posting keys, transaction recovery, accountant approval screens, and live tenant finance state are still required before TC39 or any posting ticket can be marked complete.
