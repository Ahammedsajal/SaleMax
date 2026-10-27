---
name: 7network-product-direction
description: Plan, implement or review 7Network upgrades against its customer-requirement and connected-business roadmap, including responsive EN/AR screens, light/dark themes and PWA readiness. Use for this existing 7Network/SaleMaX application; not unrelated products.
---

# 7Network product direction

## Product authority

The owner-approved direction is in `docs/7NETWORK_VISION_ROADMAP.md` at the repository root. Read it before planning a feature, new screen, category, network workflow or AI capability. It is the canonical vision; do not maintain a second roadmap in this skill.

The destination is customer login → requirement → relevant business proposals and permitted calls → acceptance → fulfilment/completion, connected to businesses' daily operations in the existing platform.

## Locate the project and evidence

Use the active 7Network checkout and its AGENTS.md. For a globally discovered invocation outside the checkout, locate the user's intended checkout; the known Mac path is `/Users/ahammed/Documents/ChatGPT/7network`. Do not substitute a different checkout or copy credentials. Repository-relative paths below apply on Windows and other machines too.

Read `docs/7NETWORK_TRAINING_CENTER_IMPLEMENTATION_PLAN.md` and relevant portions of `docs/IMPLEMENTATION_STATUS.md` before implementation. Consult `docs/UNIFIED_FEATURE_API.md` for API changes and `docs/7NETWORK_REBRAND.md` for UI/brand work. Status documents are evidence pointers, not proof of current runtime; inspect owning sources and current deployment evidence when the task requires it.

## Direct the requested increment

- Connect the requested work to its customer/business outcome and roadmap dependency. Preserve the full 42-ticket objective and existing release gates. Do not turn a narrow authorised task into a whole-platform build.
- Extend existing admin/business/agent modules, shared identity/context, `/api/workspace` handlers and maintained browser client. Keep the current plan catalogue, assignments and entry points. Future customer surfaces must integrate with shared identity under explicit customer permissions; they do not justify another CRM or business login.
- Keep shared primitives separate from industry-specific rules. Check actual module structure before selecting implementation patterns. Avoid a universal untyped entity model or premature service split.
- Customer visibility and contact grants are explicit, bounded and revocable. Matching does not grant access to phone numbers, attachments, competitor proposals, internal lead notes or other tenant data. Preserve a separate private business lead linked to a network requirement.
- Treat commitments, stock, payments, consent and AI tool actions as authoritative server-validated operations. Model suggestions are drafts until accepted under the relevant authority. Evolve AI capability through evaluated, cost-bounded assistance and supervised actions before narrow delegated automation.
- Use the responsive/theme/PWA contract in the roadmap for all new and materially changed UI: phone/tablet/desktop reflow, EN/AR and RTL, light/dark semantic tokens, accessible touch/keyboard interaction, complete states, standalone navigation and safe caching. Reuse the current shell; do not manually modify minified application logic.
- Identify permissions, migrations, concurrency/retry risks, compatibility, acceptance checks and rollback appropriate to the increment. For visual work, inspect actual screens in the affected themes/viewports/languages and state any unverified combinations.

## Completion and scope

Keep planned, source implemented, tested, deployed and accepted status separate. Update the implementation ledger for completed work; do not claim a live capability from a design or isolated test. Change the roadmap only for an owner-approved direction change or a clearly labelled refinement consistent with it.

For production access follow `skills/7network-production-change/SKILL.md` and the repository access/release instructions; this skill does not replace them. Vision approval alone does not authorise external messages/calls, purchases, fund handling, mass data sharing or unrelated deployment. Continue ordinary authorised implementation without introducing new approval gates.
