# SaleMaX API documentation

Integration requirement: extend the current SaleMaX project and existing admin/user modules. Existing plan operations are /api/admin/add_plan, edit_plan, get_plans and update_plan. Versioned services must be connected through compatible, authenticated adapters with reviewed legacy-ID/ownership mappings, preserving the current Manage Plans and Manage Users workflows. A test-only /api/v1 handler is not a replacement module or evidence that the existing screen is upgraded. No new frontend project, separate CRM or parallel login is authorized.

Status: implementation in progress. This document and the future OpenAPI contract expand with each verified ticket; the planned API list is not presented as implemented functionality.

## Verified baseline

- `GET /healthz`: existing runtime liveness response with `success`, `status`, uptime, memory and QR runtime counts. This is not yet a database/worker readiness contract.
- `GET /api/web/get_web_public`: existing public branding/settings route. Preserve response compatibility during the upgrade; private tenant settings must not be added to this public payload.
- `GET /api/theme/get-theme-config`: existing theme route; browser behavior and full response schema remain part of TC01/TC35 mapping.

Legacy route families are mounted from `server.js`. TC35 will publish exact authenticated request/response/error schemas, role/capability requirements and tenant resource constraints before new domain endpoints are enabled. No new training-center finance API has been implemented yet.

## Source route inventory

`LEGACY_ROUTE_INVENTORY.json` records 20 mounted families, 369 statically declared router routes and four direct app routes, with source lines and declared middleware identifiers. Generated through Acorn AST parsing, it excludes commented-out handlers. It does not expose secrets or payload data. Router-global and inline guards still require review; the inventory is not an authorization guarantee or complete OpenAPI specification.

`LEGACY_SCHEMA_INVENTORY.json` records existing column types/nullability/keys and index definitions only. It omits data/defaults/credentials. These actual structures underpin TC35 ownership mappings, data validation and migration/adoption contracts.

## Local design preview API

These endpoints exist only in `scripts/preview-workspace.cjs` on loopback port 3015. They do not authenticate real users, use the imported database, create accounts, or send messages. Never mount this server or its role-picker endpoints into production.

`GET /api/preview/context?role=owner&category=training_center` accepts roles `super_admin`, `staff`, `owner`, `accountant`, `manager`, `agent` and categories `training_center`, `restaurant_fixture`. Both parameters are optional with the example values as defaults. HTTP 200 returns `designPreview:true`, `syntheticData:true`, selected `role`, `audience`, category key/title, policy-filtered `nav`, permitted synthetic `leads`, payment-verification permission `finance`, synthetic `context` and `checks`. Bilingual text uses `{en,ar}`. Tenant navigation includes key, target path, capability, permission, scope, label and group; platform navigation omits the unused tenant capability/path. Accountant lead outcomes exclude sales notes.

`GET /api/preview/inspect?role=agent&category=training_center&key=leads` returns HTTP 200 with `{allowed:true,scope,permission,capability,implementedWorkflow:false,syntheticData:true}` for a permitted navigation item. An unavailable item returns HTTP 200 `{allowed:false,code:"PERMISSION_DENIED"}`. This is a design inspection result, not the intended status contract of future production resource APIs. Invalid role/category selection returns HTTP 400 `{code:"INVALID_PREVIEW_SELECTION"}`; unexpected failures use HTTP 500 with the same bounded error code. Arrays/objects in place of selectors are rejected.

Preview responses are `Cache-Control:no-store` with a self-only CSP and no embedding/form submission. The browser only sends fixture selectors and navigation keys.

Canonical session/policy/ownership interfaces and incomplete production prerequisites are documented in [PLATFORM_FOUNDATION_CONTRACT.md](PLATFORM_FOUNDATION_CONTRACT.md). No `/api/v1` authentication, training or finance endpoints are claimed implemented by this increment.

Canonical plan publication, generic assignment and seat-reservation contracts remain in [PLAN_AND_SEAT_CONTRACT.md](PLAN_AND_SEAT_CONTRACT.md). The existing-admin business assignment adapter for explicitly linked training centers is implemented and documented below; generic canonical assignment still rejects mapped legacy businesses so it cannot bypass the synchronization adapter.

The canonical auth router now implements login, session lookup/logout, MFA enrollment and TOTP/recovery verification. Exact cookie/Origin/CSRF requirements, bounded responses and activation limits are in [AUTHENTICATION_CONTRACT.md](AUTHENTICATION_CONTRACT.md), with the machine-readable [OpenAPI 3.1 handler contract](AUTHENTICATION_OPENAPI.json). In the existing host it is conditionally mounted at `/api/admin/platform-auth`, behind the existing administrator session; `SALEMAX_PLATFORM_ENABLED` defaults off. Tests also mount it on an ephemeral loopback HTTP server against disposable MariaDB. No `/api/v1/auth` route is currently mounted.

The first-owner operations command is `npm run bootstrap:super-admin -- --legacy-admin-id <id>`. It requires the owner to be explicitly reviewed, the exact existing administrator UID and password, and no prior platform memberships. It creates the canonical Super Admin identity, one active owner membership, the exact legacy-admin link and an audit event atomically. See [AUTHENTICATION_CONTRACT.md](AUTHENTICATION_CONTRACT.md). This command is not part of normal deployment or migration automation and has not been run against imported or production data.

## Existing catalogue create/edit validation (1 October 2026)

`POST /api/admin/add_plan` and `POST /api/admin/edit_plan` retain the existing administrator Bearer middleware and `{success,msg}` response convention. This compatibility increment does not enable canonical staff access or the versioned-plan adoption bridge.

Both operations accept `title` (trimmed string, 1–999 characters), `short_description` (trimmed string, 1–10000 characters), `plan_duration_in_days` (required integer 1–2147483647), `contact_limit` and `qr_account` (integers 0–2147483647, default zero). Edit additionally requires a positive integer `id`. Flags `allow_tag`, `allow_note`, `allow_chatbot`, `allow_api`, `is_trial`, `wa_warmer`, and `rest_api_qr` accept booleans or explicit 0/1 values; omitted flags default disabled. Strings such as `false` and fractional limits are rejected instead of silently coerced.

`price` defaults to zero and supports whole units up to 99999999 in the preserved BIGINT catalogue. Fractional prices are rejected before SQL execution; a reviewed decimal-money migration is still required. `price_strike` is optional/null and supports nonnegative amounts with up to two decimal places. Trial plans store price zero. The handlers update only the catalogue row; they do not modify existing user-plan JSON snapshots or canonical assignments.

Validation failure returns HTTP 200 with `{success:false,code:"INVALID_PLAN",msg,errors:{field:message}}` to preserve the legacy client contract. A missing edit target returns `PLAN_NOT_FOUND`; database failures return `PLAN_SAVE_FAILED` without private SQL/error detail. Real disposable MariaDB checks verify create/edit, preserved IDs, zero/one flags, trial price, and rejection of fractional legacy prices before writes. Existing-screen browser acceptance and canonical publication/history integration remain pending.

## Existing-shell verification runtime

`scripts/existing-panel-lab.cjs` serves the original `client/public/index.html`, compiled assets, maintained editor hooks and actual legacy admin/web/theme routers on loopback 3017. It creates a randomly named synthetic database on the isolated MariaDB test engine at 3309 from row-free schema metadata, seeds invented credentials, disables dotenv loading/provider workers, and allowlists only necessary plan/login/settings reads and plan writes. It never targets imported DB port 3307 or production. The runtime access file under ignored `database/local-runtime/existing-panel-lab` is private test material.

With the isolated test engine running, execute `node scripts/existing-panel-lab.cjs`, then `node scripts/existing-panel-smoke.cjs` from another terminal. The smoke verifies the actual original route/middleware and catalogue database path. Stop the lab when finished; Windows abrupt terminal interruption may leave a synthetic database, so verify cleanup rather than claiming it automatically occurred. This fixture is not a replacement application or production bootstrap. Category/version/seat integration remains outside this completed compatibility increment.

## Existing user-plan assignment transaction

`POST /api/admin/update_plan` retains the existing administrator middleware, `uid` and `plan:{id}` request fields, and HTTP-200 `{success,msg}` convention. The server loads the selected catalogue row; additional client plan fields cannot override the stored contract. Optional `requestId` is a UUID for idempotent retries; omission preserves older callers by generating a new ID per request. Optional `expectedState` is a 64-character lowercase SHA-256 preview token derived from the current raw stored plan and expiry. The inline Manage Users assignment control supplies both fields and `expectedPlanState` (the reviewed catalogue row hash). The original compiled account editor remains compatible but does not supply these tokens.

When a legacy assignment preview or confirmation targets an explicitly mapped training-center account, the handler returns HTTP 200 `{success:false,code:"CANONICAL_ASSIGNMENT_REQUIRED",msg}` without changing the account or assignment history. The maintained inline editor uses that stable code to explain why and offers **Open training-center contract**, which continues through the authenticated preview/confirmation adapter. Do not retry by changing the request body or bypassing the protected contract route.

The handler requires InnoDB `user`, `plan` and `sx_legacy_plan_assignments` tables. Apply the seventh forward migration `20261001_user_plan_history.sql` before activating this code. It locks the matching user and selected catalogue row, rejects missing or duplicated user identifiers, validates whole-day duration (1–365000), copies the server-loaded plan snapshot, computes epoch-millisecond expiry and records prior/new snapshots plus administrator UID in one transaction. Reusing the same request for the same actor/user/plan returns the original result; conflicting reuse and stale state fail without another assignment. CRM synchronization remains after commit and connection release, and is disabled in local-only testing.

Success additionally returns `assignmentId`, `expiresAt`, `replayed`. Bounded failure codes include `INVALID_ASSIGNMENT`, `ADMIN_REQUIRED`, `INVALID_REQUEST_ID`, `INVALID_EXPECTED_STATE`, `USER_NOT_FOUND`, `AMBIGUOUS_USER`, `PLAN_NOT_FOUND`, `INVALID_PLAN_DURATION`, `STALE_ASSIGNMENT`, `STALE_PLAN`, `IDEMPOTENCY_CONFLICT`, `ASSIGNMENT_STORAGE_NOT_READY`, `ASSIGNMENT_FAILED`. Stored passwords, tokens, database errors and raw user records are not included. This compatibility history does not retrospectively invent historical assignments or activate canonical category/version/role-seat contracts. Imported and production migrations remain unapplied.


## Existing Manage Users context and preview

Both endpoints use the existing administrator validator and return HTTP-200 `{success,data}` or bounded `{success:false,code,msg}`. Successful reads send `Cache-Control: no-store`.

- `GET /api/admin/user_plan_context?userId=<positive integer>` returns `userId`, `uid`, `name`, `current:{valid,plan}`, `expiresAt`, `state` and up to 20 recent `history` entries (`id`, projected `plan`, `expiresAt`, `assignedAt`). It rejects missing or duplicate UID mappings. Invalid historical JSON is reported as `valid:false`; raw snapshots remain stored and are withheld from this response.
- `POST /api/admin/preview_user_plan` accepts `{uid,plan:{id},expectedState}`. It is read-only and returns `state`, `planState`, `current`, `selected`, `currentExpiresAt`, `durationDays`, `expiryStartsAt:"confirmation"`, `readOnly:true`. It rejects stale account state and invalid duration. It never inserts assignment history or changes access.
- Confirm with `POST /api/admin/update_plan` using the returned state tokens and a stable `requestId`. A catalogue change after review returns `STALE_PLAN`; a competing account assignment returns `STALE_ASSIGNMENT`. Reload and review again. On a lost response, retry the same confirmed request UUID to recover the original committed result.

`GET /api/admin/get_users` now projects only legacy screen fields: id, role, uid, name, email, mobile_with_country_code, timezone, plan, plan_expire, trial and createdAt, plus `plan_snapshot_valid`. Password, API key and notification credential columns are excluded. Invalid plan JSON is returned as `{}` for compatibility with the existing table; the stored raw value is retained. This is legacy administrator authorization, not proof of completed canonical staff grants or tenant adoption.

The route inventory now contains 371 declarations: the previous 369 plus these two authenticated reads. Local actual-router smoke and real-database checks cover the new contracts; production activation remains gated.


The existing-catalogue version bridge service contract, including frozen commercial snapshots and canonical MFA/permission requirements, is documented in PLAN_AND_SEAT_CONTRACT.md. The existing application now mounts its HTTP handlers into the current `/api/admin` route family; the feature flag remains off by default, and verified administrator adoption plus deployment prerequisites are still required before the panel can use them. This wiring does not by itself complete plan/category rollout.


## Protected contracts inside the existing administration module

The existing `app.js` mounts these handlers before the global JSON parser. When `SALEMAX_PLATFORM_ENABLED=true`, activation requires ten forward migrations, reviewed legacy administrator identity links and a shared private 32-byte base64 key plus an exact HTTPS origin. It is disabled by default; each route family returns 503 `PLATFORM_UPGRADE_NOT_ENABLED` while disabled. The key is never generated at production startup. Loopback HTTP is permitted only in explicit local-only mode. No new login page or catalogue shell is mounted. A regression test exercises the disabled route behavior; the disposable HTTP integration test covers enabled authentication, draft, publication and assignment behavior through the existing route handlers.

`/api/admin/platform-auth` exposes POST login/logout/mfa/enroll/mfa/verify and GET me using the canonical authentication contracts. All also require the existing legacy administrator bearer token. Cookie, Origin and CSRF requirements remain as documented in AUTHENTICATION_CONTRACT.md. The session cookie is HttpOnly; only its CSRF token is returned to the inline controls. Authentication is mounted before global body parsing so its 8 KiB limit remains effective.

`/api/admin/plan-contracts` requires the legacy administrator plus a canonical platform cookie with MFA and an active exact administrator-ID/UID/identity mapping from sx_legacy_admin_identities. Tenant cookies and a different platform identity cannot inherit authority from the bearer token. Canonical staff grants are reloaded on every request. Mutations require exact Origin and X-CSRF-Token and accept at most 24 KiB JSON.

| Method / suffix | Permission | Input / result |
| --- | --- | --- |
| GET /context | plans.read | Training-center manifest, translated feature labels and current read/draft/publish permissions |
| GET /:legacyPlanId/versions | plans.read | Latest 100 mapped versions: id/version/revision/status/category, capabilities, roleLimits, frozen commercial fields and hash |
| POST /:legacyPlanId/drafts | plans.draft | requestId UUID, categoryKey training_center, categoryVersion 1, known unique capabilities, roleLimits owner/accountant/manager/agent; 201 created version or matching replay |
| PUT /:legacyPlanId/drafts/:versionId | plans.draft | categoryKey/version, capabilities, exact roleLimits and expected `revision`; edits only the draft linked to this existing catalogue plan; returns 200 with incremented revision, 404 for a version outside this plan, or 409 for stale/published versions |
| POST /:legacyPlanId/publish | plans.publish plus recent authentication | versionId and expected revision; 200 published next revision; rejects changed catalogue data |

Role limits are nonnegative integers at most 10000, with exactly one owner. The UI starts the first version with one accountant, one manager and seven agents, and later drafts inherit the latest contract. These are plan ceilings, not automatically created accounts. Path plan IDs are server-authoritative. Bounded 400/403/404/409 outcomes cover invalid input, missing MFA/permissions/link, absent plans, stale revisions/commercial snapshots and conflicting retries. Unexpected/storage failures are 503 CATALOGUE_UNAVAILABLE; failed rejection audit is 503 AUDIT_UNAVAILABLE. Denied mutations are recorded separately from rolled-back business transactions when an authenticated canonical actor is available. Legacy token rejection retains its HTTP-200 logout convention and no longer returns tokens or database errors.

### Existing Manage Users business-contract assignments

The existing Manage Users inline action **Training-center contract** uses these feature-flagged routes under `/api/admin/business-contracts`. Each request requires the legacy administrator bearer token, an authenticated canonical platform session, MFA, an exact reviewed legacy-admin ID/UID/identity link and the current platform staff grant. Mutations additionally require the configured exact Origin and `X-CSRF-Token`. Use GET `/api/admin/platform-auth/me` to obtain a current CSRF token from the HttpOnly session cookie. Staff need `plans.read` to preview and `plans.assign` to confirm.

| Method / suffix | Result |
| --- | --- |
| GET `/:userId/context` | Current existing account, explicit ownership-link status and up to 100 published contracts for that tenant's category |
| POST `/:userId/preview` | Read-only impact. JSON body: `planVersionId` UUID and exact `roleLimits` object (`owner`, `accountant`, `manager`, `agent`). Returns frozen QAR catalogue terms, current access, category, active/pending seats, selected features, blockers and a 64-character `expectedState` |
| POST `/:userId/assign` | Confirmation body adds preview `expectedState` and stable `requestId` UUID. Atomically writes canonical assignment, existing user plan/expiry, both histories, tenant revision and audit event. A matching retry returns the original result |

Expiry starts at confirmation using one database UTC clock. The request cannot exceed the published version's category or role ceilings, reduce an in-use seat, or select an unpublished version. A missing/unverified account link fails closed; no ownership is inferred from email. After a reviewed link exists, legacy plan writers are denied for that account and the generic canonical assignment service refuses the mapped tenant so all changes must pass through this adapter. `STALE_ASSIGNMENT`, `SEATS_IN_USE`, `PLAN_LIMIT_EXCEEDED`, `PERMISSION_DENIED`, `VERIFIED_BUSINESS_LINK_REQUIRED` and `IDEMPOTENCY_CONFLICT` are safe error codes; unexpected/storage failures return 503. The tenth forward migration stores request-to-history relationships. It does not adopt, alter, or backfill customer accounts.

The static legacy inventory remains 371 declarations; these protected handlers are dynamically mounted and explicitly documented here rather than being inferred by that limited scanner. The application mounting is locally wired and fail-closed, but production activation, verified legacy-account adoption and the remaining TC06/TC40 gates are still open.

### Existing Manage Users platform-staff controls and invitation API

The **Platform staff** action is injected into the existing `/admin?page=manage-users` screen. No second admin shell or login route is introduced. Every management call still requires the existing administrator bearer token, canonical platform session, an exact reviewed legacy administrator mapping, MFA and a recently authenticated `super_admin` identity with `staff.manage`. Mutations require the configured exact `Origin` and `X-CSRF-Token`; obtain the current CSRF token from `GET /api/admin/platform-auth/me`. Staff cannot receive `staff.manage`, owner recovery/transfer, or other owner-only grants. Changes revoke platform sessions immediately.

| Method and route | Request | Success |
| --- | --- | --- |
| `GET /api/admin/platform-access/staff` | No body | `{success:true,data:{staff:[{id,email,displayName,identityStatus,accessStatus,permissions,permissionVersion}],invitations:[{id,email,permissions,status,expiresAt,invitedBy}],availablePermissions:[...]}}`; lists are bounded to 200 entries. |
| `POST /api/admin/platform-access/staff/invitations` | `{email,permissions:[...]}` | HTTP 201 with `{success:true,data:{id,email,token,expiresInHours:72,status:"pending",delivery:"copy-link"}}`. The raw 256-bit token is returned once; only its SHA-256 digest is stored. |
| `POST /api/admin/platform-access/staff/invitations/:id/resend` | Empty JSON object | Rotates the one-time token and resets expiry to 72 hours, including an expired but still-pending invite. The previous token becomes invalid. The replacement token is returned once. |
| `POST /api/admin/platform-access/staff/invitations/:id/cancel` | Empty JSON object | Cancels a still-pending invitation and disables its unaccepted identity. A later invitation to that same address safely reuses the cancelled pending identity and invalidates the earlier token. |
| `PATCH /api/admin/platform-access/staff/:identityId` | `{active:boolean,permissions:[...]}` | Updates grants/status and revokes all current platform sessions for that identity. Inactive accounts must be re-enabled by the owner; existing sessions are not restored. |
| `POST /api/admin/staff-invitations/accept` | Same-origin JSON `{token,displayName,password}` | HTTP 201 `{success:true,data:{status:"accepted",email}}`; atomically activates the canonical staff identity and its matching existing admin login, creates the reviewed ID/UID link and audit record. The link is one-use and expires after 72 hours. |

Management responses use HTTP 400 for malformed input, 403 for forbidden audience/permission/link, 404 for absent staff/invite, 409 for conflicting state or existing identities, and 503 for unavailable storage/audit. Invitation acceptance uses 400 for invalid name/password, 403 for a wrong/missing Origin, 410 for invalid/expired/cancelled/used tokens, 413 for oversized bodies, and 503 for unavailable storage. Responses contain bounded error codes only; they do not disclose SQL errors, passwords or token digests. `Cache-Control: no-store` is set. The accept endpoint accepts at most 8 KiB; management endpoints accept at most 16 KiB.

The screen creates a URL under the existing `/admin/login#staff-invite=...` entry point and presents a copy-link control. **It does not send email or WhatsApp.** An owner must share the link using an approved channel; automated delivery and provider evidence remain TC21/TC22 work. Its invite form, staff list, grant editor, renewal/cancel actions and acceptance overlay have English/Arabic labels and keyboard focus states. The machine-readable route/request/response contract is [PLATFORM_STAFF_OPENAPI.json](PLATFORM_STAFF_OPENAPI.json); this table records its permission and operational behavior in prose.

### Existing agent-account seat enforcement

The existing team endpoints remain under `/api/agent` and keep their current user authentication:

| Method / route | Behavior for a reviewed linked training center |
| --- | --- |
| POST `/api/agent/add_agent` | Creates an active account only when the current plan enables `team.members` and an agent seat remains. The response adds `seat:{used,limit}`. The eighth active account under a seven-agent assignment returns HTTP 409 `{success:false,code:"AGENT_SEAT_LIMIT",msg}`. |
| POST `/api/agent/change_agent_activeness` | Owner-scopes the target; activation checks capacity and returns the same 409 when full. Deactivation releases the seat. `activeness` must be boolean or 0/1. |
| POST `/api/agent/del_agent` | Owner-scopes deletion and deactivates any explicitly linked canonical agent membership in the same transaction. |
| POST `/api/agent/change_status_mask` | Owner-scoped update of the agent's mask-number setting. |
| POST `/api/agent/change_status_allow_send` | Owner-scoped update of the agent's new-QR sending permission. |
| GET `/api/agent/get_my_agents` | Existing list action is preserved; only fields used for agent administration are returned. Password hashes and raw owner IDs are excluded. |
| POST `/api/agent/update_agent_in_chat` | Accepts assignment only when the selected active agent belongs to the authenticated business. |
| POST `/api/agent/get_assigned_chat_agent` | Returns the assigned agent only when the agent and chat assignment belong to the authenticated business. |

Legacy accounts without an explicit reviewed `user` ownership link retain the existing creation/status/deletion behavior. During gradual rollout, absence of the ownership migration also falls back to that route. A partial or invalid ownership schema, inconsistent mapping, inactive business, missing team capability or exhausted contract does not bypass enforcement for a linked account; it returns a bounded error. Existing plan-specific seat counts combine active canonical members, pending reservations and active unlinked legacy agent rows. Seat-changing transactions lock the same tenant row as canonical invite reservation, preventing a concurrent legacy account and canonical invite from consuming the same final seat. Agent invitations and activation are documented below. Automatic delivery and accountant/manager onboarding remain tracked in TC07.

### Existing Lead Pipeline agent scope

The current business pipeline is mounted under `/api/pipeline` and uses its existing signed-in user/agent authorization. `GET /api/pipeline/board` returns all business leads to the owner and only leads assigned to the authenticated agent to an agent. `GET /api/pipeline/leads/:id`, `GET /api/pipeline/leads/:id/activity`, `PATCH /api/pipeline/leads/:id`, and `POST /api/pipeline/leads/:id/move` apply the same ownership check; unassigned leads are not visible or editable by agents. The service rechecks assignment inside each read/write transaction. `PATCH` supports lead fields, a free-text `note`, `nextFollowUpAt`, and an owner-selected `ownerAgentId` where permitted. It also accepts structured `outcome` values `no_answer`, `connected`, `interested`, `not_interested`, `follow_up_scheduled`, `wrong_number`, `requested_call`, and `sale_requested`, plus boolean `followUpRequired`. The existing lead detail form now submits these fields with the regular lead update and asks for a follow-up date when required. Each outcome appends a `contact_outcome` activity with the outcome, follow-up flag and due time. `follow_up_scheduled` and `requested_call` require a follow-up time unless explicitly overridden with `followUpRequired:false`; invalid dates are rejected. Setting `followUpRequired:false` without a new date clears an existing due time. Moving stages appends a separate activity entry. These outcomes record contact attempts only; they do not imply sale approval, invoice creation or payment. Explicit follow-up task ownership/SLA and first/closing-agent history remain open; notes must not be interpreted as structured outcomes.

`GET /api/pipeline/reports/activity?period=daily|weekly|monthly&at=YYYY-MM-DD&page=1&limit=50` returns a read-only, paginated lead activity report. `at` is optional and defaults to the current date in the authenticated business timezone. Weekly periods start Monday. The response includes the resolved UTC `from`/`to` bounds and timezone, lead-created/touched totals, outcome and note counts, follow-ups required/due/overdue, outcome breakdown, and activity items with the attending user/agent and linked lead details. `limit` is 1–100. Owners see business-wide activity; agents see only their currently assigned leads. Other legacy roles are denied. The endpoint is connected to a Reports view in the existing embedded pipeline panel, with Qatar-local period/date filters, summary metrics, paginated activity and links into existing lead details. The screen's **Export this page (CSV)** action downloads only the currently displayed rows and labels the columns in the selected language; it does not issue another API request. The endpoint does not send scheduled reports and does not include invoices, payments or finance reconciliation.

### Training-center course catalogue (initial implementation)

### Existing pipeline contacts and course opportunities (TC10 in progress)

`GET /api/pipeline/contacts/matches?phone={international-number}&email={address}` returns up to ten tenant-owned exact phone/email matches for staff review. The route requires the existing signed-in business or assigned-agent session, sends `Cache-Control: no-store`, normalizes phone numbers and lowercases valid email addresses. Owners see matches across their own business; agents see only contacts linked to their assigned opportunities. It does not merge contacts or reveal matches across workspaces. `POST /api/pipeline/leads` keeps the existing opportunity endpoint and now accepts optional `contactName`, `learnerName`, `email`, `mobile` and `contactId` fields. With `contactId`, the service links the opportunity to an existing contact in the same workspace; an unknown or foreign-workspace ID is rejected. Without it, a separate tenant contact is created, including when the phone is shared with another learner. Each opportunity keeps its own course/lead title, stage, assignment and activity timeline. Existing lead detail responses include `contact_id`, `learner_name`, and linked contact display/email fields when present. The form suggests exact matches but leaves the final reuse-versus-separate decision to the staff member. Historical leads are not auto-merged or assigned a guessed learner identity; backfill/reconciliation and browser acceptance remain open.

For a linked contact, the existing `PATCH /api/pipeline/leads/:id` accepts owner-only shared-profile fields `contactName` and `contactEmail`. The service updates the contact once and appends a `contact_profile_updated` activity to every linked opportunity in the same transaction. Agents cannot change shared contact data. `mobile` edits for linked contacts are rejected with HTTP 409 because changing a phone safely requires a reviewed WhatsApp conversation re-link workflow; the current screen disables that field for linked contacts. Existing leads without a migrated contact link preserve their prior field-edit behavior. Browser acceptance for these controls remains open.

### Existing pipeline follow-up queue (TC11 in progress)

`GET /api/pipeline/follow-ups?period=all|overdue|upcoming&page=1&limit=20` lists active follow-ups across all open stages and returns owner/agent-scoped totals, due-state counts and a page of lead, learner, stage, due time, assignment and `due_revision` details. Page is 1–10000; limit is 1–100. Agent results include only leads assigned to the authenticated agent. `POST /api/pipeline/leads/:id/follow-up/complete` accepts `{expectedDueAt}` using the queue row's `due_revision`, closes the current follow-up, clears the lead's next due time and appends a timestamped `follow_up_completed` activity. `POST /api/pipeline/leads/:id/follow-up/reschedule` accepts `{expectedDueAt,nextFollowUpAt}` where the due revision is the queue row's revision and the next due time is an ISO timestamp; it keeps the follow-up active, updates its due time and appends `follow_up_rescheduled`. Both actions lock and recheck the lead and assignment inside a transaction; completed or stale tasks return HTTP 409 so an old queue screen cannot silently alter a newer action. The existing Reports view contains the queue with open-opportunity links, owner/agent scope labels and EN/AR copy. This uses the existing lead due-time field; independent task ownership/SLA and assignment history are still open.

These routes extend the current business user's `/user` panel and use the existing bearer token, plus a verified legacy-owner-to-tenant mapping and an active training-center contract. `training.courses` is required; only the owner can currently create/edit courses, offers, batches or publish a course. Read access for accountant, manager and agent sessions is not yet adopted. Routes require `SALEMAX_PLATFORM_ENABLED=true` and migrations `20261005_training_catalogue.sql` and `20261006_training_course_learning_info.sql`; mutations require same-origin requests and return `Cache-Control: no-store`.

| Method and path | Purpose |
| --- | --- |
| GET `/api/user/training/courses?page=1&limit=20&search=&status=` | Tenant-scoped catalogue with latest QAR price, offer version count and scheduled batch count. Page size is 1–100. |
| POST `/api/user/training/courses/` | Create a draft with bilingual names/descriptions, course level, bilingual learning outcomes and prerequisites, duration, delivery mode and the first QAR price offer. Text fields are capped at 5,000 characters. Money uses integer dirhams (`priceMinor`, `registrationFeeMinor`). |
| PUT `/api/user/training/courses/:id` | Update bilingual course details, level, outcomes and prerequisites with `expectedRevision`; a stale revision returns 409. Existing price versions are not edited. |
| GET `/api/user/training/courses/:id/offers` | Read the tenant course's immutable price history. |
| POST `/api/user/training/courses/:id/offers` | Append a QAR offer version with optional validity dates and inclusions. |
| GET `/api/user/training/courses/:id/batches` | List scheduled tenant batches. |
| POST `/api/user/training/courses/:id/batches` | Add a scheduled batch with date range, language and capacity. |
| PUT `/api/user/training/courses/:id/batches/:batchId` | Edit a tenant batch's dates, language, capacity and supported status. Capacity cannot fall below reserved seats; a batch with reservations cannot be cancelled. |
| POST `/api/user/training/courses/:id/publish` | Publish a draft using `expectedRevision`; requires an active offer. |
| POST `/api/user/training/courses/:id/retire` | Retire a course using `expectedRevision`; history remains readable and mutation forms become read-only. |

Course level accepts `all_levels`, `beginner`, `intermediate`, `advanced` or `custom`. Offer and batch IDs are tenant-bound by composite foreign keys. Course and offer history is retained; retire/archive, seat reservations and invoice snapshots will be connected in later sales/finance tickets. An active scheduled batch is optional so centers can record enquiry-only courses. Tax profile, course brochure uploads, branch/trainer references and full enrollment remain future work; this increment is not a complete enrollment or sales workflow.

### Training-center agent invitations (in progress)

These routes extend the existing authenticated business and agent APIs and are connected to the existing bilingual Team Invitations view in the `/user` shell beside Agent Login. They are mounted only when `SALEMAX_PLATFORM_ENABLED=true` and require the `20261003_team_invitation_activation.sql` migration. Owner routes use the existing business-user JWT, then verify the active training-center owner-to-tenant ownership link and `team.members` entitlement on every request. Mutations require the exact configured same-origin `Origin` and JSON body. Responses are `Cache-Control: no-store`.

| Method and path | Purpose |
| --- | --- |
| GET `/api/user/team-invitations/` | List up to 200 invitation records and supported role choices, plus `seatUsage.agent: { active, pending, limit, available }`. Active excludes valid pending invitations; available subtracts both active members and valid reservations from the assigned plan limit. |
| POST `/api/user/team-invitations/` | Create one agent invitation. Body: `{ "email": "agent@example.qa", "role": "agent", "requestKey": "<uuid>" }`. Returns one-time token and `delivery: "copy-link"`; store/copy the link immediately. |
| POST `/api/user/team-invitations/:id/rotate` | Replace a pending invite token and expiry; the old link stops working. |
| POST `/api/user/team-invitations/:id/cancel` | Cancel a pending invite. |
| POST `/api/agent/invitations/accept` | Public same-origin activation. Body: `{ "token": "<43-char-token>", "displayName": "...", "mobile": "+974...", "password": "..." }`. On success creates the existing compatible agent login and one-use tenant membership. |

Invitation tokens are generated from 256 bits of randomness and only SHA-256 digests are stored. Links expire after seven days; passwords require at least 12 Unicode code points and are capped at 72 UTF-8 bytes for bcrypt compatibility. Responses use bounded error codes including `INVITE_INVALID`, `SEAT_LIMIT_EXCEEDED`, `TEAM_FEATURE_UNAVAILABLE`, and `ROLE_ONBOARDING_UNAVAILABLE`. Email/WhatsApp dispatch is not implemented. Accountant and manager onboarding remains disabled until every existing business API enforces those roles. These APIs are not production-ready evidence by themselves.

The existing Team Invitations screen displays active agents, pending reservations, the assigned plan limit and seats available. Concurrent final-seat reservations are serialized by tenant locking and covered by the MariaDB integration smoke; only one invitation can reserve the final seat.

### Existing Manage Users business provisioning

The existing `/api/admin/business-contracts` router now supports onboarding an existing legacy account into the first supported category, training center. The routes require the existing administrator bearer token, canonical platform session, MFA, reviewed administrator identity link and current `tenants.create`, `plans.read` and `plans.assign` grants. Mutations additionally require the configured exact Origin and `X-CSRF-Token`. The platform feature flag remains off by default.

| Method / suffix | Permission | Input / result |
| --- | --- | --- |
| GET `/:userId/provision-options` | `tenants.create`, `plans.read`, `plans.assign` | Safe projection of the existing user and the published training-center contract mapped to that user's current legacy catalogue plan. Read-only. |
| POST `/:userId/provision-preview` | Same | `{businessName, planVersionId, roleLimits, requestId}`. Returns current user, Qatar category, frozen QAR terms, capabilities, proposed limits, blockers, `canProvision`, `readOnly:true` and a 64-character `expectedState`. |
| POST `/:userId/provision` | Same | Confirmation repeats preview fields and adds `expectedState`. One InnoDB transaction creates the Qatar tenant, owner identity/membership, reviewed legacy ownership link, canonical and legacy plan assignment, histories, audit and idempotency record. Matching retries return the original result. |

The account must be unique, have a valid email and an assigned legacy plan with a published training-center contract. Owner limit is exactly one; other limits cannot exceed the published ceiling. Confirmation rechecks the account and contract while locked. Tenant defaults are `QA`, `QAR` and `Asia/Qatar`. The canonical owner identity has a null password hash; no legacy password is copied, and business users continue through `/user/login`. Provisioning creates no additional logins, staff invitations, course, invoice, payment or provider messages. Bounded conflicts include `BUSINESS_ALREADY_PROVISIONED`, `BUSINESS_IDENTITY_EXISTS`, `CONTRACT_NOT_FOR_CURRENT_PLAN`, `STALE_PROVISION` and `PLAN_LIMIT_EXCEEDED`. Migration `20261004_business_provisioning.sql` is required. Imported and production databases are not migrated by this implementation increment.

\n

## Phased existing-login migration status (1 October 2026)

The current `/user/login` and agent login remain the entry points. After their existing password check succeeds, accounts with an explicit reviewed ownership mapping can also receive a tenant-scoped HttpOnly canonical session cookie. On first mapped login, the just-entered password is newly hashed for the canonical identity; a prior legacy hash is never copied. Unmapped users retain the legacy sign-in response. The business-only canonical auth API is disabled unless `SALEMAX_PLATFORM_ENABLED` is explicitly enabled and cannot create a platform session.

This is an integration bridge, not the completed login experience: there is no workspace selector on the existing login screen yet; legacy JWT responses/routes remain for compatibility; full migration, API/socket adoption, account recovery and production cutover are still pending. The disposable database verifies the mapped owner path and cross-audience rejection. Production activation is not part of this change.

## Delegated staff legacy-route boundary

After staff access is accepted, the existing administrator session is permission-scoped at the shared legacy admin middleware. Staff can read Manage Users only with `tenants.read`; plan context and read-only assignment preview require `plans.read` and `plans.assign`. The `/get_admin` profile endpoint returns only the signed-in account. Legacy mutation endpoints are rejected for linked staff; use the newer plan-contract and business-onboarding actions, which check MFA, CSRF and current delegated permission. Super Admin and unmapped pre-adoption administrator compatibility is preserved.

The route inventory still includes legacy endpoints that do not use administrator middleware; their data/actions must be classified separately before staff access or production release is considered complete.

Public `GET /api/web/get_web_public` and the compatibility admin settings response now omit `fb_login_app_sec`; browser clients need only the public Facebook app ID. `GET /api/admin/get_social_login` returns only social-login settings and requires an administrator session. Linked platform staff are denied by default on this legacy route; active Super Admin and unmapped legacy administrators remain compatible.
