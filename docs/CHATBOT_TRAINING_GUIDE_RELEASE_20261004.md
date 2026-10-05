# Chatbot training guide release — 4 October 2026

## Deployed changes

- Added a category-pack guided conversation contract (`guidedReply` and `isGuidedIntent`). The training-center pack supplies the first implementation; later categories can register their own guided behavior without changing the legacy Automation Flows builder.
- Added a built-in bilingual training-center course guide for Guided and Hybrid bots. It reads only active courses, current offers, upcoming batches and published enquiry forms. It does not claim to register a learner, create a lead, confirm a seat, or collect payment details.
- Added tenant/profile/channel/conversation-scoped guided session storage with a SHA-256 conversation key, 24-hour expiry, and bounded cleanup (up to 500 expired rows every 15 minutes per app process).
- Hybrid routes menu choices and guided intents through the deterministic course guide. Other questions use the configured AI provider when AI fallback is enabled; the existing confidence and human-review behavior remains in place.
- A customer request for a person sends a bilingual pause notice and pauses that conversation for staff. Existing manual per-conversation enable/disable controls remain available in Inbox.
- The bot setup modal selects the training-center guide by default and retains the option to choose an existing active Automation Flow. The Legacy Automation Flows tab stays first and keeps its existing canvas.
- Corrected create-dialog text contrast and button styling after checking the deployed browser screen.

## Database and rollout evidence

- Migration `20261031_chatbot_guided_sessions.sql` was applied through the existing migration ledger. It creates `sx_chatbot_guided_sessions` with tenant/profile foreign keys and an expiry index.
- Active production release: `/opt/salemax/releases/chatbot-guided-retention-20261004`; container health reported `healthy` after activation.
- Production syntax checks passed for the bundled runtime, router, config, domain pack, guided handler, sidebar hook and admin screen.
- The authenticated Automation Flows page loaded the four pill tabs. The Guided Chatbot dialog showed the built-in course guide selected; no bot was saved during visual verification.
- The unauthenticated chatbot API probe returned HTTP 401 `AUTH_REQUIRED`.
- Post-migration production counts: chatbot profiles 0, channel assignments 0, provider configs 0. The migration is applied; no bot, channel, provider key or outbound message was created by this rollout.
- A restricted pre-migration database snapshot is stored at `/opt/salemax/shared/rollback-chatbot-guided-domain-20261004/salemax-pre-guided.sql.gz` (SHA-256 `3ea1ce53094b43b1e162181e9f58cf4e67e502724f765cb43c262bf85a4c86a9`). Rollback image tags and the previous release paths are recorded under each `/opt/salemax/shared/rollback-chatbot-guided-*-20261004` directory. The new table is additive; an app-image rollback does not require removing it.

## Still required before real inbound conversations

The current authenticated training-center account has no connected WhatsApp number, no active/published course data, and no AI provider configuration. The screen and runtime are deployed, but no bot is live. Connect the business number, publish accurate courses/offers/batches and an enquiry form, and configure an AI provider key through the CRM’s encrypted provider-settings UI before activating Hybrid or AI. Do not put provider keys in source control or support messages.

AI/Hybrid activation also requires the account to confirm its customer privacy notice. Guided mode does not require an AI provider. A bot must be assigned to a connected number before it can be made live.

## Repository delivery

The current local checkout has no configured Git remote and no existing commits; source files are untracked. This release was deployed directly through the established production release flow. Git commit/push remains pending a configured repository remote.
