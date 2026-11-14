# 7Network Sales Email Marketing

Status: **campaign system and completion increment are deployed to production (15 November 2026); SES is disconnected until a Super Admin configures AWS.** The release adds the 7Network Sales email workspace, explicit Phonebook email consent, SES v2 identity setup, templates, a durable campaign queue, unsubscribe handling, an Inbox-style sent-message view, and a platform Super Admin AWS SES settings dialog. AWS access keys are AES-256-GCM encrypted in the platform settings table using the existing platform key; secret values are never returned to clients or audit logs. The release did not enter credentials, create sender identities, add DNS records, or queue a campaign; the owner can connect SES in Super Admin and add the DNS records returned by AWS.

On 12 November 2026, production diagnosis found MariaDB at its 151-connection limit, with 149 idle app sessions and two idle worker sessions. The app pool allowed 200 connections and retained idle high-water connections. The pool-budget release now caps the app/report/notification pools at 100/15/5, trims idle sessions, removes the extra per-request pool, and restored MariaDB health after a controlled app and worker restart. The active Email release and migration are recorded in `DEPLOYMENT.md`.

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

1. **Foundation** — source and both production overlays are active. Migrations 20270106–20270108 are applied; email event data and provider settings are empty, and consent and account access default off. Production IAM permissions still need confirmation.
2. **Outbound pilot** — setup, templates, campaign composer, queue, unsubscribe, event intake and analytics are deployed. Super Admins can enable Email Marketing per account in Manage Users and configure SES credentials, region, configuration set and SNS topic. SES credentials/domain verification, SNS policy/subscription, production access and live event delivery remain unconfigured; sending stays gated until verified.
3. **Email Inbox** — sent messages display in the existing shell. Inbound reply storage, SNS/event verification, parsing and reply sending are not implemented yet; configure and validate them before claiming a full Email Inbox.
4. **Production acceptance** — user supplies the sending and reply domains, adds the exact AWS-returned TXT/CNAME/MX records, and requests SES production access. Verify the account, DNS, event path, rollback, tenant/role isolation, and exact active release inputs before enabling campaigns.
5. **Later category adoption** — publish reviewed category/plan changes for any additional category; preserve old plans and assignments.

## Acceptance and release gates

- Owner/manager can set up verified identities and manage templates/campaigns; denied roles and non-entitled categories receive no menu and API access is rejected.
- Campaign audience preview equals the actual eligible contacts; missing email, no consent, suppression, invalid address, and duplicate addresses are excluded with clear counts.
- Worker concurrency/restart tests prove no duplicate dispatch after an ambiguous SES response; delivery events are idempotent and tenant-scoped.
- Unsubscribe takes effect immediately and is honored by queued campaigns. Signed SNS event processing deduplicates events and suppresses permanent/undetermined bounces and complaints; production topic setup and live event delivery remain acceptance gates.
- Private attachment authorization, size/type limits, cleanup, and no-store/PWA behavior are verified.
- Existing WhatsApp Marketing and Inbox workflows remain unchanged.
- Review the actual integrated screens in both themes, EN/AR/RTL, and 360/768/1280px widths, with authenticated role and error-state evidence.
- The workspace exposes setup, templates, campaigns, analytics and sent-message Inbox while SES remains disconnected. The worker fails closed until credentials are saved, the domain and sender are verified, and SES production sending is enabled. An administrator supplies the SNS topic ARN, prepares its publish policy and HTTPS subscription, then configures the SES event destination. Inbound replies remain a separate release gate. Verify tenant/role isolation, rollback, and the exact active release inputs.

## Current evidence and open prerequisites

- Production host identity is `carsqatar-prod-01`; `/opt/salemax/current` remains base `training-pipeline-correction-v3-9867ca72-20261104`. The active app chain ends with `/opt/salemax/releases/email-marketing-completion-ab13ca859766-20261114/compose.email-marketing-completion.json`, after the pool recovery, idle-reserve, process-budget and initial Email overlays. The existing app image includes the pinned SES v2 SDK; MariaDB was not replaced.
- Migrations 20270106–20270108 are applied: 20270106 has 14/14 statements, 20270107 and 20270108 each have 2/2. The provider settings, event table and per-account Email feature are empty/off; existing contacts were not opted in, and no AWS credential or sender identity is present. Guarded migration recovery and rollback evidence are in `DEPLOYMENT.md`.
- Pool limits now account for both Node processes in the app container: app 50 each, report worker 15, and recruitment-notification worker 5, for 120 total versus MariaDB's 151. All four pools use `maxIdle=1` and a 60-second idle timeout. The final read-only check saw four sleeping client sessions plus its diagnostic query; after it closed, four established TCP sessions remained. MariaDB was healthy and the cumulative connection-limit error counter stayed at 117.
- Focused local tests pass 31/31; a Windows-local MariaDB integration could not run because MySQL was unavailable. Earlier synthetic API previews covered 390, 768 and 1280 CSS pixels, English/Arabic, RTL and light/dark. Authenticated production screen review did not complete; owner/manager/denied-role, live EN/AR, theme, responsive/PWA and complete UI-state acceptance remain open.
- A separate CRM reference deployment has managed SES settings in `eu-central-1`, but no credentials were read, displayed or transferred to 7Network. The 7Network Super Admin provider settings UI is deployed; SES account status, minimum IAM permissions, quota and production sending access remain unverified. The portal accepts replacement keys without showing previously saved values.
- The sending and reply domains are intentionally user-provided. No domain is selected or verified, and existing root-domain MX records must not be changed. The 15 November production release adds `POST /api/public/email/ses/events`, verifies SNS signatures against the saved SNS topic ARN, deduplicates events, suppresses permanent/undetermined bounces and complaints, and records metadata only. SES configuration-set delivery publishing and tenant-scoped campaign analytics are deployed. SES credentials, domain verification, topic policy/subscription, production access, live event delivery and authenticated screen acceptance remain rollout gates. SES inbound replies remain unimplemented; do not claim a two-way Email Inbox.
