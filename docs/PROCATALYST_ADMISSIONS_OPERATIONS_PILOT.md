# ProCatalyst admissions operations pilot

Status: production pilot in progress. The objective is one auditable learner
journey from a WhatsApp enquiry to a verified paid enrollment in the existing
training-center workspace. Several workflow improvements are live, but the
pilot is not complete until center records and staff operations are reconciled
and the end-to-end journey is accepted.

## Delivery status

1. **Advisor Today queue — initial release live.** The existing Inbox Today
   view surfaces due callbacks, learner conversations waiting for a person,
   registrations needing attention and pending payments, with scoped team
   visibility, assignees, follow-up context and next actions. The owner can
   open an in-app morning brief. Automatic next-shift backup routing is not
   enabled: staffed hours, holidays and backup membership must be supplied
   first. Counts remain limited to what current scoped endpoints load.
2. **Conversation to registration — initial path live.** Register learner opens
   the staff form with the linked learner/lead. The form shows responsible
   advisor and provider-verified ad source when available; ambiguous lead
   lookups are rejected. Course prefill is only used when the existing saved
   course can be matched safely. Full acceptance across roles/channels and
   payment verification is still open.
3. **Course questions and AI — partial safeguards live.** Existing approved
   course offers remain the source for fees. Unconfirmed weekday availability
   goes to a coordinator, and employment/placement questions in English or
   Arabic receive a safe coordinator handoff without job guarantees. The
   account has no confirmed active batches, so batch dates cannot yet be
   answered from verified schedule data. Approved placement copy, preferred
   schedule persistence and voice-note transcription remain open.
4. **Blocked registration notifications — not reconciled.** The three pending
   notification reviews still need to be checked against reception records.
   Fix the notification configuration and determine the original delivery
   state before any retry; do not resend blindly.
5. **Role navigation and morning brief — initial release live.** Existing
   permission-filtered landing defaults route agents/managers to Inbox,
   admissions/reception staff to Forms and accountants to Finance. Owner
   briefing is available in the app with links to underlying work. Live
   acceptance for each role and scheduled delivery are open.
6. **Paid enrollment attribution and baseline — open.** New inbound referrals
   are retained on the existing lead attribution path, and verified Meta ad
   sources appear in sale review. Historical referrals have not been
   backfilled. Paid-seat/ad reporting must wait for finance and reception to
   reconcile historical registrations, invoices and posted payments. Measure
   first useful human response and registration handling time with reception.

## Production increments

- `4c869e148f2e51ed8693a3e9f96db08db96cb85b` — Today task scoping and advisor
  labels, linked registration/advisor context, payment-verification deep link,
  permission-aware role landing defaults and English/Arabic coordinator
  handoffs for placement and unconfirmed weekday questions. Live release:
  `/opt/salemax/releases/admissions-operations-completion-4c869e14f2e-20261125T112247Z`.
- `292dd5012192970a4b0f21a7c656e50d1d3273a5` — owner sale review displays
  same-lead provider-verified Meta source when available.
- `48ce8cc3b2de8bf16ca208767bb46d78c5efd788` — new chatbot leads retain
  inbound provider referral in the existing pipeline attribution ledger.
- Earlier Inbox/registration and Today UI increments are recorded in
  `DEPLOYMENT.md`.

## Remaining acceptance and dependencies

Reception/owner must provide actual staffed hours, holiday schedule, backup
advisor and baseline workflow. The center coordinator must provide approved
employment/placement language and confirmed batch data. Reception and finance
must reconcile the three blocked notifications and historical enrollment,
invoice and posted-payment records. Only then can the pilot validate true
paid-seat attribution and ad return.

Before declaring the pilot complete, verify tenant and role isolation,
agent/manager/admissions/finance access, idempotent retries, owner morning-brief
links, English and Arabic, RTL, light and dark themes, mobile/tablet/desktop,
and safe PWA navigation. Use synthetic records for concurrency and retry
testing. Compare the reception baseline with the live workflow. Keep the
broader 42-ticket application upgrade, load/restore and remaining provider
gates open until separately verified. No customer messages or notification
retries were sent by the completion increment.
