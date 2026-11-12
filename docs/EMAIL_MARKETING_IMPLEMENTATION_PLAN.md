# 7Network Sales Email Marketing

Status: **source implemented; production deployment authorized and in progress**. The first release adds the 7Network Sales email workspace, explicit Phonebook email consent, SES v2 identity setup, templates, a durable campaign queue, unsubscribe handling, an Inbox-style sent-message view, and a platform Super Admin AWS SES settings dialog. AWS access keys are AES-256-GCM encrypted in the platform settings table using the existing platform key; secret values are never returned to clients or audit logs. This rollout does not enter credentials, create sender identities, add DNS records, or queue a campaign; the owner can connect SES after deployment.

## Outcome

Give the 7Network Sales team a small, familiar email workflow inside the current `/user` workspace: verify a sender, make reusable templates, send a consent-based campaign to email contacts in Phonebook, see delivery results, and review sent messages in an Inbox-style conversation view. Incoming replies require a separate SES receiving setup and remain a rollout gate. Keep the existing WhatsApp campaigns and Inbox behavior intact. Make the feature capability-based so another category can adopt it later through a reviewed plan version.

## Navigation and screen

Add one **Email** channel under the existing Marketing/Inbox areas, using the shared business session and `window.SaleMaxWorkspace` client. Keep the workflow to four destinations:

1. **Campaigns** — list, status, recipient counts, schedule, and create.
2. **Templates** — name, subject, text, optional simple HTML preview, and attachment presets.
3. **Email Inbox** — the same conversation list, selected-thread, message composer, attachment, and unread-state pattern as the existing Inbox.
4. **Email setup** — one guided sender/domain checklist, provider state, DNS records, and a test-send action.

The composer asks only for campaign name, Phonebook, sender, subject, message, optional attachments, and send/schedule time. Before queueing, show eligible and excluded contact counts and a final review. Reuse the current shell and semantic theme tokens; provide EN/AR and RTL, light/dark, keyboard and touch interaction, empty/loading/denied/error/success states, and narrow-phone layouts.

## Sending and consent rules

- Amazon SES is a platform-managed provider. Use the host secret store, an instance role, or the Super Admin managed settings, which encrypt the key pair in a platform-only table; never collect keys in a tenant form or save them in tenant tables.
- Use SES v2 identity APIs to request domain/email verification and display the exact DNS records and SES status, including the `_amazonses` TXT verification record when AWS returns it and the DKIM CNAME records. An email identity may require its SES confirmation email.
- Show region, sandbox/production state, quota, and provider readiness. Fail closed when SES is unavailable, a sender is unverified, or a sandbox recipient is unverified.
- Reuse Phonebook, but only include contacts with a valid email address and explicit email-marketing consent. Existing contacts start unsubscribed; phonebook membership alone is not consent.
- Add one-click unsubscribe and visible unsubscribe copy. Re-check suppression and consent immediately before dispatch. Process SES delivery, bounce, complaint, and rejection events; suppress bounced/complaining/unsubscribed recipients.
- Use a tenant-scoped durable queue with atomic recipient claims, bounded rate, idempotency, and an `uncertain` state after ambiguous provider outcomes. Do not send an entire campaign inside an HTTP request.
- Keep campaign and message attachments private, type/size limited, malware-scanned where available, and outside service-worker caches. Begin with a conservative per-message cap and expose the actual limit in the composer.

## Super Admin SES connection

Use the existing Manage Users screen and legacy admin token, then verify the linked platform session, active Super Admin membership and platform MFA permission before allowing access. Saving credentials is origin-checked, revision-checked and validated by calling SES `GetAccount` before the database transaction. A blank key pair means “keep the saved pair”; region can be changed without re-entering secrets. The settings are singleton platform-wide values, encrypted separately with random IVs and authenticated field-specific AAD. Rotating the platform encryption key requires re-entering the AWS key pair. The tenant Email Setup screen only reports region and SES account status.

## Data and APIs

Extend the existing shared feature contract and mount one `/api/workspace/email-marketing` router behind the feature-session guard. Maintain any compatibility alias by mounting the same router instance. Authorize each operation from current tenant, role, category, plan entitlement, screen assignment, and permission; never trust a tenant or owner ID supplied by the browser.

Create separate tenant-scoped records for sender identities, templates, campaigns, recipients/delivery attempts, consent/suppression, email threads/messages, and private attachment references. Keep WhatsApp campaign tables unchanged. Use immutable campaign content snapshots and auditable consent/unsubscribe transitions. Add a reversible forward migration; never mutate published plan versions or grant another category access by default.

Use the `email.marketing` capability in the 7Network Sales contract and its permission/navigation mapping. It is currently scoped to that private category. Other categories can receive it later through their own reviewed adoption; a shared permission must not automatically activate the feature.

## Inbound replies and email Inbox

SES sending and SES receiving are separate. The current Inbox screen shows accepted campaign messages in a shared-inbox layout and tells the user that incoming replies are not yet connected. Receiving needs a supported SES receiving region, a verified reply subdomain, MX routing, an active receipt rule set, and a durable private storage/event path. Use a dedicated reply subdomain so existing root-domain MX records are not replaced. Store raw messages privately, verify AWS event authenticity, parse bounded MIME safely, and retain attachment access through tenant-scoped authorization. Reply sending uses the same tenant sender/permissions and SES queue.

## Delivery sequence

1. **Foundation** — source is implemented locally: feature contract, schema, SES adapter, private attachments, and Phonebook consent/suppression fields. Still verify the migration against a disposable schema and confirm production IAM permissions.
2. **Outbound pilot** — source is implemented locally: setup, templates, campaign composer, queue, unsubscribe, and status summaries. Still add SES delivery/bounce/complaint event handling and run synthetic recipient/concurrency checks.
3. **Email Inbox** — sent messages display in the existing shell. Inbound reply storage, SNS/event verification, parsing and reply sending are not implemented yet; configure and validate them before claiming a full Email Inbox.
4. **Production acceptance** — user supplies the sending and reply domains, adds the exact AWS-returned TXT/CNAME/MX records, and requests SES production access. Verify the account, DNS, event path, rollback, tenant/role isolation, and exact active release inputs before enabling campaigns.
5. **Later category adoption** — publish reviewed category/plan changes for any additional category; preserve old plans and assignments.

## Acceptance and release gates

- Owner/manager can set up verified identities and manage templates/campaigns; denied roles and non-entitled categories receive no menu and API access is rejected.
- Campaign audience preview equals the actual eligible contacts; missing email, no consent, suppression, invalid address, and duplicate addresses are excluded with clear counts.
- Worker concurrency/restart tests prove no duplicate dispatch after an ambiguous SES response; delivery events are idempotent and tenant-scoped.
- Unsubscribe takes effect immediately and is honored by queued campaigns. Bounce and complaint suppression remains an open implementation gate.
- Private attachment authorization, size/type limits, cleanup, and no-store/PWA behavior are verified.
- Existing WhatsApp Marketing and Inbox workflows remain unchanged.
- Review the actual integrated screens in both themes, EN/AR/RTL, and 360/768/1280px widths, with authenticated role and error-state evidence.
- The first release can expose the setup, template, campaign, sent-message Inbox, and Super Admin credential screens while SES remains disconnected. The worker fails closed until credentials are saved, the domain and sender are verified, and SES production sending is enabled. The owner supplies the sending domain and adds the exact TXT/CNAME records returned by SES. Bounce/complaint event processing and inbound replies remain separate release gates before claiming a full email Inbox or expanding beyond a controlled pilot. Verify tenant/role isolation, rollback, and the exact active release inputs.

## Current evidence and open prerequisites

- Production host identity remains `carsqatar-prod-01`; the read-only check on 11 November 2026 resolved `/opt/salemax/current` to `training-pipeline-correction-v3-9867ca72-20261104`. The app container was running `salemax-app:openai-ads-lead-01fde9e1-20261103` on Node 22.23.3.
- Production preflight on 12 November 2026 confirms the app and database are healthy, the report worker is running, and all 240 current Compose/environment inputs are present. `/opt/salemax/current` remains the base release; the active app overlay is `pipeline-show-all-leads-28d21c99df43-20261111`. The exact Compose chain is reconstructed from the live container labels and will be checked again under the protected release lock.
- Source-branch checks previously passed: 22 focused unit tests; a disposable MariaDB Phonebook integration; and a disposable email integration covering the forward/rollback migration, encrypted credential storage, Super Admin status redaction, revision races, audit redaction, email-only contacts, consent transitions and category isolation. Re-run these after merging the current production Phonebook overlays. Local browser previews used synthetic API fixtures at 390, 768 and 1280 CSS pixels with English/Arabic, RTL and light/dark checks; authenticated acceptance inside the production shell remains open.
- The separate CRM reference deployment has managed SES settings enabled in `eu-central-1`, with access-key fields encrypted in its Laravel database. Those settings are not available to 7Network automatically; no credential values were read, displayed or transferred. The 7Network app container has no `AWS_*` environment variables, and an instance role or other secret provider has not been confirmed. The planned Super Admin provider settings store has not yet been deployed. The adapter defaults to `eu-central-1`; once deployed, SES identity creation, status checks, test sends and campaign workers read the encrypted platform-level settings. No key values were read or transferred from the separate CRM.
- The 7Network app image does not include the SES v2 SDK yet. The guarded release will derive an app image from the exact active image and install the pinned SDK without adding AWS credentials. SES account status and minimum IAM permissions remain unverified. After deployment, the owner can connect AWS in the Super Admin portal; verify production access, sending status, quota and minimum IAM actions before a pilot send. The portal accepts replacement keys without showing previously saved values.
- The sending and reply domains are intentionally user-provided in Email Setup. No domain has been selected or verified, and existing root-domain MX records must not be changed.
- Before the guarded release, no SES identity, DNS, customer contact, database, campaign, credential, or message has been changed. The email migration will add nullable email and default-off consent fields and empty tenant-scoped email tables; it does not opt existing Phonebook contacts in.
