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
