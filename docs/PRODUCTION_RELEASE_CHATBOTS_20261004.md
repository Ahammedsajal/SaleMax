# Chatbot management release — 4 October 2026

## Deployment

- Service: `https://crm.salemax.qa`
- Release: `/opt/salemax/releases/chatbot-modes-20261004`
- Previous release: `/opt/salemax/releases/course-outline-create-fix-20261004`
- Previous app image retained as `salemax-app:rollback-chatbot-20261004`
- Pre-release database dump: `/opt/salemax/shared/rollback-chatbot-20261004/salemax-pre-chatbot.sql.gz`
- Database dump SHA-256: `a3f20d34a21481ef7bca5f224a4c2224082a44543f35d01f26345aa0ae8645bf`

## Included changes

The existing SaleMaX panel now loads Guided, Hybrid and AI chatbot management after the unchanged Automation Flows tab. The release includes tenant and category aware bot profiles, connected-number assignment, provider configuration, guided-flow reuse, hybrid fallback, grounded training-center responses, category-pack extension points, and Inbox bot pause/resume controls. Per-chat state is isolated by tenant, WhatsApp channel type, connected number and conversation ID. Existing legacy chatbot API endpoints and the CRM shell remain in place.

The release also adds the additive migration `20261030_chatbot_profiles.sql` and updates the existing Inbox runtime and chatbot route mounting. The live sidebar cache key is `training-sidebar.js?v=20261004b`.

## Database and account changes

The existing migration runner applied `20261030_chatbot_profiles.sql`; its other 41 migrations were already applied and retained matching checksums. The six chatbot tables are present. Profile, channel-assignment and conversation-control row counts were zero after deployment. No bot profile, provider credential, channel assignment, customer plan entitlement or WhatsApp conversation was changed by the rollout.

## Verification

- Production app container reports healthy.
- Public `get_web_public` endpoint returns success.
- Public HTML references `training-sidebar.js?v=20261004b`; the new sidebar asset is served from the public edge.
- Unauthenticated `GET /api/user/chatbots` returns HTTP 401 `AUTH_REQUIRED`.
- 14 chatbot profile/runtime tests, 6 screen-contract tests and 3 provider tests passed in the production build environment.
- Node syntax checks passed for the changed runtime, router, Inbox and browser scripts.

Authenticated visual acceptance passed in a training-center session: the four rounded tabs render, Automation Flows remains first, and Guided, Hybrid and AI show the training-center category. The inspected account has no connected WhatsApp number, compatible saved chatbot flow, AI provider configuration or bot profile. Live connected-number message handling and an AI-provider round trip remain pending. No production bot has been activated.

## Rollback

The previous app image and release remain available. To restore application code, repoint `/opt/salemax/current` to `/opt/salemax/releases/course-outline-create-fix-20261004`, retag `salemax-app:rollback-chatbot-20261004` as `salemax-app:latest`, then recreate the app with `docker compose --env-file /opt/salemax/shared/stack.env -p salemax -f /opt/salemax/current/deploy/compose.yml up -d --no-build app`. The chatbot tables are additive; leave them in place during application rollback unless a separate database rollback is reviewed, because removing them would delete any bot configuration created after deployment.
