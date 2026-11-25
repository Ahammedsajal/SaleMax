# ProCatalyst admissions operations pilot

Status: in development. The outcome is one auditable journey from a WhatsApp enquiry to a verified paid enrollment, within the existing training-center workspace.

## Delivery order

1. Establish an advisor queue from existing tasks, handoff claims and registration exceptions. Apply the existing workspace permissions and team scope to every row. Show the latest actionable incoming message, owner and next action with links to the source. Define staffed hours, holidays and backup membership before activating automatic rerouting. Preserve claim history and use transactional, idempotent reassignment.
2. Connect the registration action in the Inbox to the published staff form and its existing lead. Prefill only authorized, verified fields, including course where unambiguous. Retain the original lead and referral history. Surface possible existing invoices without treating a provisional registration document as payment.
3. Extend the existing chatbot facts and handoff flow for fee plus schedule questions. Answer from the current offer and confirmed batch, retain a learner's preferred schedule and send the unresolved question to an advisor. Employment and placement wording requires approved center content. Evaluate English and Arabic examples, missing and expired offers, unconfirmed dates, handoff and duplicate message scenarios before enabling additional customer-facing answers.
4. Repair registration notification configuration and give reception a reviewable list of blocked deliveries. Reconcile the three pending reviews with actual center records before retrying any notification. Keep retries idempotent and distinguish provider acceptance from delivery.
5. Introduce role-aware landing views with existing navigation and permission checks. Provide a morning owner view with links to underlying callbacks, open handoffs, pending approvals and pending payments. Connect source attribution to the existing lead and finance records. Label unknown attribution and never infer payment.
6. Compare first useful human answer and registration handling time with a reception baseline. Trace an actual approved, posted payment to the originating enquiry and ad source. Validate synthetic data and staff workflows before accepting the pilot.

## Existing dependencies and open decisions

Production has current course offers and an existing form submission path that accepts a selected lead. The inspected account has no recorded batches and its historical registration and finance records require reconciliation. Reception must establish actual staffed hours, a backup advisor, the active batch and a baseline. Keep changes disabled or manual where these facts are missing.

Before release, validate tenant and role isolation, agent and owner sessions, concurrency, retry behavior, English and Arabic, RTL, light and dark themes, mobile and desktop. Verify the existing production overlay inputs, snapshot changed assets, deploy through the protected release workflow and record the source revision, migrations, rollback and live checks in DEPLOYMENT.md.
