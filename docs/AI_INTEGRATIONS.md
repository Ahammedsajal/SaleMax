# Business AI integrations

The existing business panel exposes **AI Integrations** at
`/user?page=ai-integrations`. It uses the common workspace session and the
owner-only `/api/workspace/ai/settings` API. Business Profile and the bot editor
link here instead of maintaining independent credential forms. Cached clients
can still use `/api/user/chatbots/settings/provider` through the same router.

One active provider/model/key is shared by a business. OpenAI, Google Gemini and
DeepSeek are the adapters currently implemented; model suggestions come from the
server catalogue and custom model IDs remain supported. The page is not a vault
for several independently saved providers. Changing provider requires that
provider's key. Leaving the key empty preserves the existing encrypted key when
the provider is unchanged. Existing revision conflicts, owner permission, Origin,
cookie CSRF and the requirement to pause live AI bots before changing credentials
remain enforced. Secrets are encrypted server-side and never returned to clients.

## Prompt caching and cost

Supported OpenAI GPT-5.6+ chat requests specify `prompt_cache_options` with a
30-minute minimum lifetime. Grounded answers use explicit breakpoints after the
system policy and freshly fetched business evidence. Customer questions and the
short conversation summary follow those reusable prefixes. Evidence remains
untrusted user data and is fetched on every request; edits alter the prefix.
Flow conversations use implicit reuse plus the stable initial policy breakpoint.
An opaque hash of workspace/workload scopes provider cache accounting. No phone
number, API key or customer name is used in the cache key. We do not pad prompts,
prewarm with billable requests, or promise a hit for short or unique prefixes.

The provider adapter reads OpenAI cache-read/cache-write token details, DeepSeek
cache hits and Gemini cached-content tokens. All shared callers propagate usage:
bot, Inbox suggestion, translation, flow conversation and handoff summary.
Monthly estimates use verified OpenAI cached-read and 30-minute cache-write rates;
other providers and unknown models retain conservative ordinary-input estimates.
Read discounts and write premiums are separate, because caching can cost more on
an unreused prefix. The $10 monthly owner/manager reminder remains informational;
it never stops replies. Provider invoices remain the billing authority.

`GET /api/workspace/ai/settings/usage` returns the current Qatar calendar month's
input/output tokens, cached input, cache writes, read savings, write premiums,
metered requests and requests with cache reads. Migration
`20270123_ai_prompt_cache_usage.sql` adds six columns to the existing monthly
ledger. Historical costs are preserved; cache details start with this release.
Rollback retains these additive columns and all newer usage/customer writes.

Primary references, reviewed 3 November 2026:
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching),
[Chat Completions cache controls](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
[GPT-6 Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Further AI work, in priority order

These are proposed extensions, not enabled features:

1. **Knowledge-gap review:** group unanswered questions and repeated handoffs,
   propose FAQ/course-field corrections with evidence, and let the owner approve
   them. Start with certificate, online delivery and batch-schedule gaps. This
   improves both staff productivity and future bot replies.
2. **Lead extraction and follow-up drafts:** suggest course interests, requested
   timing, objections and a next action from the latest messages. Staff review
   before changing CRM fields or sending a follow-up.
3. **Conversation quality review:** sample replies for wrong-course context,
   unanswered questions, unsupported claims and missed handoffs. Report the
   relevant message references and track improvements without bulk external sends.
4. **Manager summaries:** explain unattended leads, overdue follow-ups and course
   demand using permission-scoped aggregates. Reuse incremental summaries and
   batch non-urgent analysis where the chosen provider supports it.
5. **Content assistance:** draft English/Arabic course descriptions, FAQs and
   campaign text from approved business facts. Keep publication and channel
   consent/template checks in their existing workflows.
6. **Finance assistance:** explain overdue balances and draft collection notes
   from authoritative ledgers. Staff retain payment verification, corrections,
   refunds and financial commitments.

Extend the existing typed AI runtime as these are authorized. Prefer a small,
bounded context and one incremental summary per conversation over repeatedly
sending the full transcript. Add per-workload cost attribution before assigning
different providers/models or unattended actions to new workflows.
