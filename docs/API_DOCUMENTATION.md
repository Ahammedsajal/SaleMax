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

Plan publication/assignment and seat-reservation transaction interfaces, storage, errors and required future HTTP mappings are documented in [PLAN_AND_SEAT_CONTRACT.md](PLAN_AND_SEAT_CONTRACT.md). They are backend services only; the staff and team routes will be documented here after authenticated handlers and screens are implemented.

The canonical auth router now implements login, session lookup/logout, MFA enrollment and TOTP/recovery verification. Exact cookie/Origin/CSRF requirements, bounded responses and activation limits are in [AUTHENTICATION_CONTRACT.md](AUTHENTICATION_CONTRACT.md), with the machine-readable [OpenAPI 3.1 handler contract](AUTHENTICATION_OPENAPI.json). Tests mount it on an ephemeral loopback HTTP server against disposable MariaDB. It is not mounted in the main application or production; `/api/v1/auth` remains the target family.

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

The handler requires InnoDB `user`, `plan` and `sx_legacy_plan_assignments` tables. Apply the seventh forward migration `20261001_user_plan_history.sql` before activating this code. It locks the matching user and selected catalogue row, rejects missing or duplicated user identifiers, validates whole-day duration (1–365000), copies the server-loaded plan snapshot, computes epoch-millisecond expiry and records prior/new snapshots plus administrator UID in one transaction. Reusing the same request for the same actor/user/plan returns the original result; conflicting reuse and stale state fail without another assignment. CRM synchronization remains after commit and connection release, and is disabled in local-only testing.

Success additionally returns `assignmentId`, `expiresAt`, `replayed`. Bounded failure codes include `INVALID_ASSIGNMENT`, `ADMIN_REQUIRED`, `INVALID_REQUEST_ID`, `INVALID_EXPECTED_STATE`, `USER_NOT_FOUND`, `AMBIGUOUS_USER`, `PLAN_NOT_FOUND`, `INVALID_PLAN_DURATION`, `STALE_ASSIGNMENT`, `STALE_PLAN`, `IDEMPOTENCY_CONFLICT`, `ASSIGNMENT_STORAGE_NOT_READY`, `ASSIGNMENT_FAILED`. Stored passwords, tokens, database errors and raw user records are not included. This compatibility history does not retrospectively invent historical assignments or activate canonical category/version/role-seat contracts. Imported and production migrations remain unapplied.


## Existing Manage Users context and preview

Both endpoints use the existing administrator validator and return HTTP-200 `{success,data}` or bounded `{success:false,code,msg}`. Successful reads send `Cache-Control: no-store`.

- `GET /api/admin/user_plan_context?userId=<positive integer>` returns `userId`, `uid`, `name`, `current:{valid,plan}`, `expiresAt`, `state` and up to 20 recent `history` entries (`id`, projected `plan`, `expiresAt`, `assignedAt`). It rejects missing or duplicate UID mappings. Invalid historical JSON is reported as `valid:false`; raw snapshots remain stored and are withheld from this response.
- `POST /api/admin/preview_user_plan` accepts `{uid,plan:{id},expectedState}`. It is read-only and returns `state`, `planState`, `current`, `selected`, `currentExpiresAt`, `durationDays`, `expiryStartsAt:"confirmation"`, `readOnly:true`. It rejects stale account state and invalid duration. It never inserts assignment history or changes access.
- Confirm with `POST /api/admin/update_plan` using the returned state tokens and a stable `requestId`. A catalogue change after review returns `STALE_PLAN`; a competing account assignment returns `STALE_ASSIGNMENT`. Reload and review again. On a lost response, retry the same confirmed request UUID to recover the original committed result.

`GET /api/admin/get_users` now projects only legacy screen fields: id, role, uid, name, email, mobile_with_country_code, timezone, plan, plan_expire, trial and createdAt, plus `plan_snapshot_valid`. Password, API key and notification credential columns are excluded. Invalid plan JSON is returned as `{}` for compatibility with the existing table; the stored raw value is retained. This is legacy administrator authorization, not proof of completed canonical staff grants or tenant adoption.

The route inventory now contains 371 declarations: the previous 369 plus these two authenticated reads. Local actual-router smoke and real-database checks cover the new contracts; production activation remains gated.


The existing-catalogue version bridge service contract, including frozen commercial snapshots and canonical MFA/permission requirements, is documented in PLAN_AND_SEAT_CONTRACT.md. It is not yet mounted as HTTP operations or available in the production panel. Do not call an unmounted service a usable category/seat assignment workflow.
