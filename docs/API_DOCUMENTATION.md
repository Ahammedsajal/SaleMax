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
