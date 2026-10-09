# Student registration

Open the existing student-registration form while signed in as an owner, manager or assigned sales agent. Select **Lead** to reveal a search box directly below the source. Search by name, mobile or email and select a result. Imported student details remain editable. Agents can search only their assigned leads. Public visitors cannot search the CRM and receive a staff-sign-in action when they choose Lead.

Select Walk-In or Student Referral for other sources. Referral name becomes required for referrals. Staff capture requires an attended-staff selection; public applicants do not see the staff roster. QID, nationality, certificate name, address, birthday, education and emergency contact are optional. Optional student details can also be saved or edited in the existing Pipeline lead form and imported during registration.

Select a published course, optional available batch and either full payment or the course offer's installment plan. The system derives fees and installment amounts from the current offer. Course settings contain a student ID prefix; leaving it blank uses the course code. IDs are allocated atomically on submission as PREFIX-YEAR-000001. A preview is not a reserved number.

The student draws a digital signature using a mouse, finger or pen and accepts the agreement. The saved form retains signature strokes and consent evidence, and its A4 print renders the signature. Language switching preserves entered values and the signature.

Submitting atomically creates a registration, a student pending approval, a provisional invoice, an immutable pending sale review, a Pipeline stage/activity and delivery requests. It does not post payment or reserve a seat. The Students screen shows pending registrations, approval state, printable documents, delivery results and a link to the existing Pipeline review. After approval, existing Finance conversion issues the accounting invoice and enrollment under the approved finance policy. Invoice issuance automatically queues another set of notifications and an invoice attachment. Duplicate submission/conversion retries do not issue duplicate numbers or invoices. Pipeline reports reflect the registration stage and activity; finance reports reflect the issued invoice after conversion.

## Notification configuration

The existing report worker also processes registration delivery requests. Candidate destinations come from the submitted contact. Owner/accountant destinations come from active tenant memberships and their linked legacy contact details. A missing accountant is shown as a blocked recipient rather than silently omitted. No identity document or signature is included in notification content.

Runtime configuration remains external to Git:

- Email: `SALEMAX_REGISTRATION_EMAIL_ENABLED=true`, `SALEMAX_REGISTRATION_FROM` and the existing `SALEMAX_SMTP_HOST`, `SALEMAX_SMTP_PORT`, `SALEMAX_SMTP_USER`, `SALEMAX_SMTP_PASS`, `SALEMAX_SMTP_SECURE` settings.
- WhatsApp: `SALEMAX_REGISTRATION_WHATSAPP_ENABLED=true`, `SALEMAX_REGISTRATION_WHATSAPP_TEMPLATE`, optional `SALEMAX_REGISTRATION_WHATSAPP_LANGUAGE` (default `en_US`) and optional `SALEMAX_META_GRAPH_VERSION`. The tenant's existing Meta account provides its phone ID and token. The approved template requires five body parameters: student ID, course, document number, QAR total and approval state.
- `LOCAL_ONLY_MODE=true` prevents all registration sends, even if the individual flags are enabled.

Each channel reports pending, blocked, accepted, failed or unknown. Accepted means provider acceptance, not inbox/device delivery. Missing configuration is retried after five minutes. Uncertain transport outcomes and abandoned sending leases become unknown and are not automatically resent, preventing duplicate notifications. Failed/unknown outcomes require operational review.

## Verification

Disposable MariaDB verification covers all 69 forward migrations, registration retries, concurrent IDs, lead import, rollback on invalid referral, pending approval, approval-to-invoice conversion, delivery gating and injected email acceptance. Browser checks cover phone-width English/Arabic layout, source-triggered lead search, imported QID and signature preservation. Real provider delivery requires configured channels and recipient acceptance evidence.
