# 7Network for ChatGPT — MCP connector scope

**Production status (2 November 2026):** `https://7network.live/mcp` and the connection manager in the existing 7Network business panel are deployed. The signed-in page and empty connection state load correctly. No ChatGPT workspace has connected yet, so OAuth from ChatGPT, tool calls and workspace publication remain unverified. See `DEPLOYMENT.md` for release and rollback evidence.

**Product thesis:** make ChatGPT a permission-aware 7Network copilot for finding the next best business action, while the existing 7Network app remains the place to manage accounts, people, access, and operational records.

This is a custom MCP app/connector, not the retired ChatGPT Plugins API. ChatGPT connects to the remote MCP endpoint, the user authorizes an existing 7Network account with OAuth, and each request is checked against that account's current tenant and role. Workspace app setup and an individual user's 7Network account authorization are separate steps.

## First release: Lead Follow-up Copilot

### User journey

1. A ChatGPT workspace administrator adds `https://7network.live/mcp` as a custom MCP server and completes the tool scan.
2. A business owner, manager, accountant, or agent connects their own 7Network account in the OAuth consent screen. If both owner and agent sessions are present, they choose which identity to connect.
3. They choose read and write permissions individually. `tasks.manage` never silently implies `tasks.read`.
4. In ChatGPT they can search permitted leads, inspect upcoming/overdue follow-ups, list follow-up tasks, create a task assigned to themselves, and update a task status.
5. They can review and revoke each connection from the existing 7Network business panel's ChatGPT page.

### Tools

| Tool | Access | First-release behavior |
| --- | --- | --- |
| `search_pipeline_leads` | `pipeline.read` | Bounded, tenant and role scoped search by lead title or customer/learner name. Omits phone numbers and message history. |
| `get_pipeline_follow_ups` | `pipeline.read` | Lists permitted upcoming/overdue lead follow-ups. |
| `list_follow_up_tasks` | `tasks.read` | Reads permitted personal or team follow-up tasks. Team access remains role controlled. |
| `create_follow_up_task` | `tasks.manage` | Creates an idempotent task assigned to the connected account for an existing lead. No customer message is sent; existing internal task notifications may notify the assignee. |
| `update_follow_up_task_status` | `tasks.manage` | Changes a permitted task using its expected revision, rejecting stale updates. |

### Explicit first-release boundaries

- No send-message, WhatsApp, email, calling, campaign, payment, refund, delete, bulk export, or broad administrator tool.
- No contact details, chat transcripts, credentials, session cookies, or cross-tenant search in MCP responses.
- No separate CRM, login, account catalogue, or replacement business panel.
- Access tokens are short-lived, opaque, stored as digests, and revalidated against current role/tenant policy. Refresh tokens rotate; reuse revokes the token family. Users can revoke a connection inside 7Network.
- Write access is separately consented. ChatGPT may still ask users to confirm tool actions according to its own app and workspace controls.

## The improvement that makes this valuable

Build toward a **Revenue Recovery Desk**, not a generic "chat with your CRM" connector. A user should be able to ask, “Which warm leads need attention today, what evidence makes you think so, and what should I do next?” The answer should cite the permitted 7Network record and its last activity, explain the reason, and offer a reversible task action. A later workflow could rank stale high-value leads, prepare a follow-up for review, and create an internal task only after the user approves it. Then measure whether the follow-up happened and the opportunity moved stages.

That creates a closed loop from customer requirement to permitted sales activity and fulfilment, matching the 7Network roadmap. Start with the existing Pipeline and task system; expand only after owners can verify useful recommendations and permission boundaries with real accounts.

## Suggested roadmap

### Phase 1 — Secure connector pilot

- OAuth account linking, explicit scopes, live role rechecks, revocation, audit trail.
- Lead and follow-up read tools plus supervised internal task management.
- Connection management in the existing `/user` and `/agent` business shell.
- Validate tool discovery, consent, reconnect, revocation, per-role access and real ChatGPT web behavior with a synthetic/test tenant before enabling broader workspace access.

### Phase 2 — Explainable sales workbench

- Include stable 7Network record links and timestamps in results so staff can verify the source.
- Add a `prepare_follow_up` read-only tool that returns a short action brief grounded only in permitted Pipeline fields; keep generated message text as a draft and never send it.
- Offer a daily at-risk follow-up view and narrowly scoped filters such as owner, stage, due date, and priority where the current role allows them.
- Add an audit page showing which account invoked which tool, when, and whether it succeeded, without logging customer message bodies or secrets.

### Phase 3 — Approved actions

- Add draft/save actions before any external communication. Require a distinct permission, visible preview, idempotency key, and explicit user confirmation for each send.
- Consider CRM updates, form handoff, proposal preparation, or fulfilment only as category-specific workflows with existing services and permission checks.
- Keep high-impact actions out of background automation until action-level approval, retry, cancellation and rollback semantics are proven.

### Phase 4 — Measure and commercialize

- Track connection activation, weekly active accounts, follow-up tasks created/completed, overdue lead reduction, stage movement and attributable recovery. Use tenant-safe aggregation and clear retention limits.
- Validate demand before pricing. A sensible test is to bundle read access, then offer approved action workflows as a higher business tier or usage add-on, with per-seat controls and transparent AI/provider cost limits.
- If the connector is adopted by resellers, provide a tenant onboarding checklist and workspace-admin setup guide; never share one tenant's OAuth grant across customers.

### Phase 5 — Proactive events and consented demand capture

- After the request/response pilot proves reliable, consider [MCP Events](https://developers.openai.com/plugins/build/mcp-events) for opt-in follow-up reminders in supported ChatGPT Work environments. This requires durable subscriptions, authenticated HTTPS callbacks, replay protection, delivery retries and a clear unsubscribe/revoke path; it is not part of the deployed pilot.
- A longer-term acquisition loop could let a person describe a business need in ChatGPT, then explicitly choose whether to share it with eligible 7Network businesses. Route that requirement into the existing proposal and fulfilment workflow, show who will receive it, and record consent. Keep identity and contact details private unless the person approves sharing; never broadcast one tenant's pipeline to another.

## Current pilot status

The r6 endpoint and existing business-panel account screen are deployed. Public checks confirm health, OAuth metadata, MCP routing and unauthenticated access denial. The authenticated 7Network page loads and reports an empty connection list. No real ChatGPT account is connected yet, and no MCP tool has been called from ChatGPT. Workspace setup, OAuth consent, live role checks and tool execution must be verified before enabling the connector for a wider workspace.

## Acceptance gates

- ChatGPT web can scan the server, complete OAuth/PKCE, receive refreshed credentials, list tools, and call each permitted tool. This is still open until an authorized workspace administrator performs the setup and a user completes a real connection.
- English/Arabic consent, RTL, phone/tablet/desktop layout, keyboard focus and dark/light styling are checked.
- Business owner and agent accounts connect independently; managers/accountants see only their existing role grants; changing or revoking a role cuts off stale access.
- Synthetic tenant tests prove tenant isolation, task idempotency under concurrency, stale revision rejection, audit creation and no customer contact side effects.
- Production health, app-only rollback and tracked release evidence are verified. A 7Network production deployment alone does not complete ChatGPT workspace publication; an authorized ChatGPT admin must create/test/publish the custom app and confirm real OAuth and tool calls.

## ChatGPT availability and setup

As of 2 November 2026, OpenAI documents custom MCP server connections on ChatGPT web for Business and Enterprise/Edu workspaces. Business workspace admins/owners create and publish custom apps; Enterprise/Edu administrators can delegate creation and control access with RBAC. Full write-capable MCP is not the same as a read-only Pro connection. Current availability and UI labels can change; follow the [OpenAI custom MCP server setup guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) when configuring a workspace.

The administrator adds the endpoint `https://7network.live/mcp`, selects OAuth, completes authorization, scans tools, tests the connection, and publishes it to the intended workspace. Each 7Network user then signs in with their own account and grants scopes. Do not publish the app to all members until the role/tenant acceptance gates above have passed.
