# Retail and WooCommerce implementation and deployment plan

Status as of 16 November 2026. This plan extends the existing 7Network Retail category inside the current business workspace. It does not introduce another application, CRM, login, plan catalogue, or shell.

## Delivery decision

Use the existing Retail & Inventory category and /user panel as the operating workspace. The owner selected the live Essentials by D store and the 7Network tenant owned by `admin@retail.com`, and approved a dedicated read-only WooCommerce key, data import, and connector installation. Connector 1.0.1 is active and adds no storefront or checkout fields. Keep WooCommerce authoritative; do not write catalog, stock, order, price, or payment data back. The owner wants integration through WooCommerce and the existing 7Network admin workspace, with no storefront, checkout, or payment-setting changes. An owner-only key entry and signed product/order/customer webhooks are admin configuration; configure webhooks only after a full sync reconciles. Keep the optional checkout-event plugin endpoint blank and do not send customer messages. The live Connected Stores screen still falls back to Dashboard, so no REST key or data sync has been created yet. TFB is a later rollout.

The rollout order is:

1. Reconcile production source and migration history.
2. Pilot Essentials by D’s live WooCommerce store with read-only synchronization.
3. Agree fabric units and extend stock semantics.
4. Show imported orders and purchase history in the existing Retail Orders and CRM workflows; then add controlled Woo write-back.
5. Complete delivery, documents, reports, and the retail notification outbox.
6. Enable only consent-aware recovery, stock alerts, campaigns, and Meta actions that pass their own gates.

Each phase is a separately reviewed release. A staging pass is not production acceptance. Preserve the current /user shell, Manage Plans and Manage Users flows, tenant authorization, English/Arabic and RTL behavior, light/dark theme, responsive states, and PWA-safe navigation and caching.

## Existing implementation found

| Area | Present in production/source | Material gap |
| --- | --- | --- |
| Category and access | Retail category key retail_boutique version 1, titled Retail & Inventory; private and planable. Current main already has the category, retail navigation entries, policy capabilities, shared feature-session wiring, and Manage Plans/Manage Users flows. | Keep this contract and historical assignments. Do not create a second category or plan flow. |
| Product and inventory | Existing product catalogue and inventory workspace; SKU/code, product name, status, price/catalogue records, stock movement history, multiple locations, reservation-aware available stock, stock adjustment, and inter-location transfer. Store listing visibility, public photo choice, and store option groups are present. | Stock quantity validation is integer-only. Stock movements are keyed by product and location, not a Woo variation. Store option groups do not establish independent inventory for Woo product variations. No fabric unit model, per-location low-stock threshold, or back-in-stock subscriber workflow was found. |
| Native retail orders | Existing public 7Network storefront; catalogue, pickup/delivery checkout, order status changes, driver assignment, delivery failure/retry, delivery proof code, cash collection, settlement, returns, and an accounting-source CSV. The native order flow deducts internal stock on completion. | This is the native 7Network storefront. Imported WooCommerce orders are stored in connector-specific tables and are not yet proven to appear in the same Retail Orders workflow. There is no courier tracking adapter or retail invoice/receipt PDF workflow. |
| Connected stores | WooCommerce and Shopify connection APIs; owner-only setup; encrypted connector credentials and webhook secrets; read-only product/order/customer scopes; signed webhook ingestion; imported product, order, customer, transaction, and checkout records; privacy export/redaction and imported-data erasure. | Essentials by D live import is approved but not yet connected. Connector 1.0.1 is active with no checkout UI; no Woo REST key, provider round-trip, webhook, or reconciliation is evidenced. No catalog or stock write-back is deployed. |
| Woo checkout plugin | Connector 1.0.1 is active and posts signed started, abandoned, and recovered cart events only when configured. It adds no storefront or checkout fields, scripts, or notices; payloads omit customer email, phone, and consent. It does not change prices, stock, order totals, payments, or refunds, and does not send customer messages. | The live endpoint and secret are blank, so no events have been sent. Event hooks have only been verified for classic checkout; Checkout Blocks event coverage is unverified. Recovery messaging still requires an approved consent source outside this plugin. |
| CRM and purchase history | Native order actions can link an order to the existing pipeline. Imported Woo customer/order snapshots are tenant-scoped in connector tables. | No explicit and audited match/merge path into tenant CRM purchase history was found. |
| Finance and notifications | Native retail cash receipts, driver settlement, and CSV export exist. Retail notification and consent migrations exist. | Retail PDF invoices/receipts, email/WhatsApp delivery, period/product/channel/staff retail reports, and tested courier tracking remain incomplete. The live shared notification worker rejects both retail event kinds; see the release blocker below. |
| Shell acceptance | Retail navigation and category routes are in the current shared shell sources. Relevant retail assets are mounted in production. | The active production index.html hash is e910aba4ca3a7c6d43834d7f3e363610e818561bb3a66f4bfcb37abbdd5482ed. Its retail-related script references include business-inventory.js but not retail-workspace.js. On 16 November 2026, a signed-in visit to `/user?page=retail-connected-stores` rendered Dashboard, and the sidebar showed Inventory but no Connected Stores entry. The active session was not verified as the Essentials by D owner. The review branch now registers the recovered retail workspace hook in the existing `client/public/index.html`; this is source-only and not deployed. Do not enter a key or claim Retail acceptance until the intended owner session sees the screen after a reviewed release. |

The connected-store release result recorded zero enabled stores, zero entitled plans, and zero active commerce assignments at that release snapshot; the signed-in owner pilot remained open. This is a historical release snapshot, not a query of current tenant data. This reconciliation did not read customer/order rows, connector credentials, or current tenant connection state.

## 0. Source reconciliation — review branch

The production app was healthy on image tag email-marketing-21a07cc41fa9-20261112, digest sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667. The current pointer /opt/salemax/current resolves to base release training-pipeline-correction-v3-9867ca72-20261104. The running container uses a layered Compose chain; the base release itself does not contain deploy/compose.yml, so inspection used the running container's Compose labels and mounts.

Selected retail/category-related file mounts were compared between release source and the running app container. Every selected mount matched byte-for-byte; per-file hashes are recorded below. Exact deployed commerce, connector, inventory, client, and migration files have been restored to the reconciliation worktree from their recorded Git blobs. The supplied WooCommerce ZIP is excluded by the repository’s global ZIP ignore rule, so its PHP and README payloads were extracted byte-for-byte into versioned source files; the original deployed package hash is retained below. Current main already contains the Retail category and shell policy/navigation; those shared files were preserved. No production behavior changed and no migration was rerun.

| Runtime path | Release source / source commit | SHA-256 |
| --- | --- | --- |
| client/public/business-inventory.js | retail-orders-workspace; 5bf8f98ba4421768aa0dcccc54bad4a9d45bab00 | 6d1054a3f44709ccb330dfb9d5a2636df1e821e7b6a4b86791e0864dbe11ddc3 |
| client/public/retail-consent.html | retail-commerce; b3a940b81d9a2ed5542016196c2b5c3b42b5dd34 | 90595af8bc08891a52cc1b1e88f4124de3257824ba8d8071af2878179c65b213 |
| client/public/retail-consent.js | retail-commerce; b3a940b81d9a2ed5542016196c2b5c3b42b5dd34 | 9ec90dc31bf27d26843f3e468cd7689d5970ae712788970534985108bdd9039b |
| client/public/retail-shop-sw.js | retail-orders-workspace; 5bf8f98ba4421768aa0dcccc54bad4a9d45bab00 | 48f738915bae4073c9785814c0b22e60f1bcdccc93709aa8d43d625d7da7bad4 |
| client/public/retail-shop.css | retail-commerce; b3a940b81d9a2ed5542016196c2b5c3b42b5dd34 | 410fa4916252cd2005df112f772b14f50ce66f723571c0f2e921f4bc51898c69 |
| client/public/retail-shop.html | retail-orders-workspace; 5bf8f98ba4421768aa0dcccc54bad4a9d45bab00 | 1ed7fd970eecb22952eb05626b7f637cc88f57c9ad083d056acf0728a21b3a90 |
| client/public/retail-shop.js | retail-orders-workspace; 5bf8f98ba4421768aa0dcccc54bad4a9d45bab00 | 6950f7eb72c1e37f53be7e4f8f2f6eed324d01465a87dac03fc155f3eff5f359 |
| client/public/retail-workspace.css | retail cash reconciliation; 4b0c416ea4b54ce445f90c1a5cf143e326b9935b | f1098f22eb9c3361ac4db610093fc1f28da6a0c618b57754ad98833d8bab1b9f |
| client/public/retail-workspace.js | retail cash reconciliation; 4b0c416ea4b54ce445f90c1a5cf143e326b9935b | b539e129d74dddb6a7fe27ebd0c37be4a88b190aed4f6874c597cc31b1b3f535 |
| modules/platform/business-inventory-router.js | retail-commerce; b3a940b81d9a2ed5542016196c2b5c3b42b5dd34 | 23743b9017bc257415efb1477e2c2c78a05a634194a014bd8b5d9cd3070bb638 |
| modules/platform/retail-commerce-router.js | retail cash reconciliation; 4b0c416ea4b54ce445f90c1a5cf143e326b9935b | 0e7702172f33cf7880dd6044e80ae4e7776f090df60d46718b41407f7a705fd4 |
| modules/platform/retail-commerce.js | retail-orders-workspace; 5bf8f98ba4421768aa0dcccc54bad4a9d45bab00 | a6ea4e08972056ed048dbd58f3e2aafe07c037d047fac6dc4955e38d37b47b44 |
| modules/platform/retail-connected-stores-router.js | retail-commerce; 1d3fc3c3d42f196944a3ef3c1b5dc6f07a81059e | 962268f47f12a3dec46da80e5a20cd7e152f4aef7e4b22ce47737fec6e6cc8c6 |
| modules/platform/retail-connected-stores.js | retail-commerce; 1d3fc3c3d42f196944a3ef3c1b5dc6f07a81059e | 6bae9b6cbd36de53e08ed2114cfa3860ab75adb16f70f99658b5fa55a112d16c |
| modules/platform/retail-delivery-proof.js | retail-commerce; b0f5dc376ec0471d6c55401a183031a8163e410a | 88383150d6b971c45348740c3b0e69b8061c99b9a5890ac60d945ca899ea6a93 |
| modules/platform/retail-notice-consent.js | retail-commerce; b3a940b81d9a2ed5542016196c2b5c3b42b5dd34 | 44587cc1df90845c150f37dbe65eabcdb4ccedc97beff5c41e4173d13601d1ab |
| integrations/woocommerce/7network-retail-connector/7network-connector.php | extracted from deployed package; 1d3fc3c3d42f196944a3ef3c1b5dc6f07a81059e | 313f8400a4121a499a4985eaf29a635328b38bab1514feeeaedb70ba95b119c6 |
| integrations/woocommerce/7network-retail-connector/README.txt | extracted from deployed package; 1d3fc3c3d42f196944a3ef3c1b5dc6f07a81059e | 21d128577e899aa31f1eb0b807c0849b50d1ff07a5fed639f82da01c76245e3c |
| modules/platform/category-aliases.js | email-marketing-completion; current main source | 9a9b3c0c26e258a1b0fc7820e7eb7e42b258e9516d3b31715c621335af543700 |
| modules/platform/business-notifications.js | Pro Catalyst English handoff alert; current main source | 3e29abd5166d3432364fcb2bf3ede5cd99c76e0e8a1af85ab258b08ec797ad5e |

The original ignored WooCommerce archive SHA-256 is `df58e25d2ec245569ffbfebd67a7c82c8f36b808551fe857586726fbfdad8e7c`. Its PHP and README members are the tracked source of record; the ZIP packaging artifact is not committed.

### Applied migration ledger

The live database ledger reports all entries below as applied, with complete statement counts and checksums matching the effective release files. These migrations are source history only in this task; do not apply them again.

| Migration | Status | Statements | SHA-256 |
| --- | --- | --- | --- |
| 20261215_category_product_catalog.sql | applied | 6/6 | 7b9d29966870cbc5099da96570e2267529421f8fcc74215917fe38d85923c388 |
| 20270125_private_business_inventory.sql | applied | 1/1 | cc8f9d9e392dd0e8c590c44f48b6fc5c07ed94f29f39412ef2aafbd0a117c81b |
| 20270126_retail_commerce.sql | applied | 4/4 | a12b03a999ab3bf1d93deee2ae0fb6526c19e76b03202c9e64e7b247b9277937 |
| 20270127_retail_cash_and_returns.sql | applied | 6/6 | c48a1d234cea07ed340903e858d44b46cfc606d82a5b60b0d7e0a13b90c11843 |
| 20270128_retail_delivery_retries_and_proof.sql | applied | 4/4 | 80d98779059448c0a0badd600f25daad2946d42b162b0838af8635cc63761468 |
| 20270129_retail_locations_and_variants.sql | applied | 14/14 | f199ccba712489ba9e7e5e009448ff5a48b8bc1727324388aec913025122d920 |
| 20270130_retail_notifications.sql | applied | 2/2 | 92721d7600c8b9c19e8ad16d3162c729c7ab8dd3e59a2938973b3e4c37600512 |
| 20270131_retail_customer_notice_consent.sql | applied | 6/6 | 7c508472a558417a9585c3e86696d8d50177a2e5eff5a26d6dcf42b2e939896b |
| 20270132_retail_connected_stores.sql | applied | 9/9 | bd3d89b18bf243e92a218eb8ef00cd5d24199aa9a8eb8f08bd3aca3ed50e98f9 |
| 20270201_retail_catalogue_schema_compatibility.sql | applied | 1/1 | 31bb90b2fc741d243570eaddf89bc292c2e4b7c9b83659750c9511dfc6e527a2 |
| 20270202_retail_order_email_search.sql | applied | 1/1 | 35430ee37ea164cd9c995c31801388793ac6f413bd0ceb5eea39f672870f3f50 |

Migration 20270133_retail_woocommerce_product_sync.sql and retail-product-sync.js appear in a remote retail branch, but neither is mounted in the running app nor present in the production migration ledger. They are deliberately excluded from this reconciliation and are not deployed capability.

### Migration rehearsal evidence and blocker

The focused Retail migration pair, `20270132_retail_connected_stores.sql` followed by `20270205_retail_woocommerce_variations_reconciliation.sql`, has applied successfully on isolated MySQL 9.6 and MariaDB 11.4.13 databases with only a minimal `sx_tenants` base table. The MariaDB rehearsal verified all six decimal order-total columns, the product SKU column, and the variation-to-connection foreign key; its temporary database and server were removed. This checks the SQL for the Retail pair, not the full application migration runner or backup/restore.

The first full MariaDB replay confirmed the missing notification-settings prerequisite. A source-only repair now adds an idempotent `20261023_business_notification_settings_bootstrap.sql` before the default-time alteration and makes the later table creation idempotent. Because production already records the old checksum for `20261225_business_whatsapp_notifications.sql` (`16bf454a59b59d29e1a07fdd25e56658e476ae9bfe708061ceb445ddfbd613ca`), the runner accepts only that exact historical checksum for that exact migration; new databases record the current file checksum. A focused migration-runner test for this compatibility rule passes.

A subsequent ordered SQL-only MariaDB 11.4.13 replay passed the former `20261024` failure and applied 100 of 165 migration files, then stopped at `20261207_qr_channel_shares.sql` because the disposable fixture did not include the legacy `beta_chats` table. No tracked migration creates that legacy table; it is part of the application's pre-existing database baseline. The disposable server/database were removed. This run does not prove the complete migration chain or backup/restore. A full application-runner rehearsal also remains unverified because local Node/mysql2 startup stalled before applying migrations. The earlier MySQL 9.6 full-chain attempt remains incompatible with MariaDB-specific generated-column syntax. Reconstruct the canonical application baseline and run the full chain through the real migration runner on the supported MariaDB version, then complete backup/restore before release. No migration was applied in production.

### Release blocker: notification worker kind mismatch

The running shared worker accepts invoice, payment, daily summary, AI usage, and chatbot handoff events. The live retail order service enqueues retail_order_event and retail_customer_order_event. The shared enqueue function rejects unknown kinds; the retail service calls it inside order/status transactions when the corresponding notification setting or customer consent is enabled. This can fail the transaction when retail notifications are enabled. The release snapshot says retail notifications default off and no customer notifications were sent; current tenant settings were not read.

Do not cherry-pick the entire notification worker from the retail feature branch. That branch is older than current main and drops newer shared behavior. Implement a targeted handler on current main before enabling retail alerts: tenant and plan checks; staff alert setting; per-order transactional consent and destination-hash check for customers; idempotent event keys; no personal destination in the outbox payload; recheck eligibility before dispatch; and preserve the existing retry/unknown-delivery rules. Test that a provider failure cannot create duplicate orders, receipts, or stock movements.

## 1. Essentials by D live WooCommerce pilot — read-only

### Build and configure

- Connect only `https://essentialsbyd.com` to the tenant owned by `admin@retail.com`, using a dedicated WooCommerce REST key with read permission only. The owner has authorized creating the key in WooCommerce admin and entering it in the existing Connected Stores form, which encrypts credentials at rest and clears them from the form. Do not put keys in source, logs, chat, or the deployment record. No storefront page, checkout field, payment gateway, price, stock, or order data is to be changed. After the initial import passes reconciliation, add signed product, order, and customer webhooks in WooCommerce admin; these update only connection configuration. Keep the checkout-event plugin endpoint blank and its customer-messaging path off.
- Keep the connector scopes limited to products, orders, and customers. Leave product/stock/order write-back disabled. Make imports read-only and repeatable.
- Run the baseline read-only import against the explicitly approved live Essentials by D store. Importing its customer/order data into its own 7Network tenant is approved. Request `status=any` for products, variations, and orders so reconciliation covers non-published catalog entries and all supported order states the read key can access; record the query scope with source totals. Follow WooCommerce pagination headers rather than assuming one page. Add bounded work, checkpoints, retries, and an audit record for each owner-requested sync. Do not change store catalog, stock, orders, checkout, payment settings, or customer data; do not send customer messages during this pilot.
- Store Woo product ID and variation ID separately. Use normalized SKU as the preferred cross-system match. Quarantine missing or duplicate SKUs for owner mapping; never silently merge by product name. Include the Woo store ID in every external key.
- Import order status, currency, line totals, discounts, shipping, tax, fees, payment state, refunds, timestamps, and customer external IDs as source snapshots. Preserve decimal strings through normalization; compare values in exact currency minor units after confirming the store currency and decimal rules.

The WooCommerce REST API has separate product-variation endpoints, status filters, and `X-WP-Total` / `X-WP-TotalPages` collection headers. The source connector now follows those headers and retains status/variation IDs: [WooCommerce REST API v3: pagination, products, orders, and variations](https://woocommerce.github.io/woocommerce-rest-api-docs/).

### Pilot acceptance

- Product and variation counts match Woo for the same sync cutoff; report unmapped and duplicate SKUs separately.
- Order counts reconcile by date range and status. Amounts reconcile by currency and separately show subtotal, discount, shipping, tax, fees, refunds, and net paid. Explain rounding and Woo order-state rules before sign-off.
- Re-running the same sync creates no duplicate external products, orders, customers, or transactions. In isolated synthetic tests, webhook replay and REST resync converge to the same final snapshot. After the first full reconciliation is accepted, signed webhooks may keep the read-only projection current without writing back to Woo.
- Demonstrate pagination, timeouts, authorization failure, bounded retry, webhook signature rejection, duplicate webhook delivery, and a recoverable interrupted sync using mocks/disposable fixtures.
- No Woo data is changed. No order/customer is copied into the business CRM during this stage.

For a separately approved future webhook rollout, monitor WooCommerce delivery logs: WooCommerce can disable a webhook after repeated failures, so prove recovery through an owner-triggered resync before enabling the hook: [WooCommerce webhooks documentation](https://woocommerce.com/document/webhooks/).

**Gate:** The Essentials by D owner reviews and accepts the counts and amount reconciliation report, product/variation-to-SKU mapping, and order-state rules. If totals differ, remain read-only and investigate. Do not begin write-back, configure the optional checkout-event plugin, or enable customer messages. After reconciliation, signed resource webhooks may be configured in WooCommerce admin; that does not add checkout fields or change payment settings. Use this acceptance to decide when to begin a separate TFB rollout.

**Rollback:** Pause or revoke the connection from 7Network and use the reviewed tenant-scoped erasure path only if the Essentials by D owner requests removal of imported records. Remove only the connection’s signed webhooks from WooCommerce admin if the owner requests full disconnect. The checkout-event plugin endpoint remains blank. Retain audit evidence and never erase the source store’s records.

## 2. Fabric inventory semantics

Define a tenant-configurable unit model before a schema change. For Essentials by D, confirm its actual sellable units and count rules with the owner. Separately preserve the supplied TFB requirements for yards, pieces, and panels; do not assume those units describe Essentials by D. Confirm:

- Whether yards are fractional, the smallest sellable increment, and required display precision.
- Whether pieces and panels are indivisible units, and whether a panel is a separate SKU/variation or a conversion from measured length.
- Which products may convert between units, and the exact approved factor and rounding rule for each conversion.
- Which stock locations map to Woo locations. If Woo exposes one stock value only, do not imply branch-level quantities.

Recommended model for approval: one base unit per SKU/variation and location; store quantity in integer base quanta (or verified fixed-decimal representation with decimal-safe arithmetic), never JavaScript float. A future TFB profile may use fractional yards and whole pieces/panels, but that is not an Essentials by D decision. Do not convert between units without a stable, owner-approved per-variation conversion recipe. This recommendation is not a decision; each tenant must approve precision and conversions.

Add an additive, tenant-scoped stock profile per variation: base unit, display unit, scale/precision, conversion rules, and effective date. Extend stock movements and reservations to key by variation and location. Backfill existing integer product stock as whole units without changing totals. Add a per-variation/per-location low-stock threshold and an idempotent outbox transition when available stock (on hand less reservations) crosses the threshold. Back-in-stock notifications require an explicit customer subscription per product/variation/channel and revocable consent.

Acceptance covers fractional rounding at the chosen scale, piece/panel whole-unit validation, variation/location isolation, transfers, reservations, cancellation, returns, concurrent counts, duplicate requests, and old integer stock compatibility. Use synthetic fixtures and a disposable database before any live migration. Keep Woo authoritative while the new model is read-only.

**Gate:** Essentials by D approves its unit/conversion matrix and location mapping before tenant configuration; TFB repeats this approval during its later rollout. Operations approve how count corrections and returns are audited.

**Rollback:** Disable unit-aware writes and render existing stock as whole units. Keep the additive schema and movement ledger; do not drop tables or reverse committed movements as an application rollback.

## 3. Bring imported orders into Retail Orders and CRM

Reuse the existing /user Retail Orders screen, shared feature-session context, /api/workspace APIs, and common browser API client. Extend the current order read model instead of adding a second CRM or panel.

- Make source channel and external identity explicit: provider, connection, Woo order ID, Woo product ID, Woo variation ID, and synchronization revision. Enforce uniqueness on tenant, store, resource kind, and external ID.
- Show Woo orders in the existing Retail Orders list with source and sync state. Keep payment/refund truth from Woo visible and distinguish it from 7Network cash receipts. Do not create a second payment or count imported stock twice.
- Link line items to reviewed SKU/variation mapping. Leave ambiguous lines unresolved and visible to an owner; never guess a variation.
- Add purchase history as a tenant-scoped CRM view over imported external orders. Retain the external snapshot as the source record; use a view/adapter or normalized reference, not a second editable order copy.
- Match an external customer only when normalized email or E.164 phone finds exactly one active contact in the same tenant and the role may view that contact. If there is no match or more than one candidate, leave it unlinked and offer an audited owner review. Never fuzzy-match by name/address or across tenants. A match does not grant broader access to contact data, messages, notes, attachments, or other tenant records.
- Provide an audited unlink/merge correction path using existing connector privacy controls.

Acceptance uses synthetic staging orders for unique match, no match, duplicate contact, email-only, phone-only, changed phone/email, guest checkout, refunds, and duplicate webhook/resync. Verify purchase history permissions for owner, accountant, manager, and agent, including denied cross-tenant access and unauthorized contact fields.

**Gate:** Imported orders reconcile to Woo and appear in the existing screen; CRM matches are explicit, reversible, and role-checked.

**Rollback:** Stop imports and hide the source projection behind the Retail feature flag. Keep encrypted snapshots and sync cursor; do not delete linked CRM contacts as a rollback shortcut.

## 4. Controlled catalog and stock write-back

The current Woo connector has no write-back path. Add and test it only after phases 1–3 pass, first against a disposable WooCommerce staging store. Continue to treat Woo as the sole stock authority for any Woo-connected tenant: 7Network records a staff intent, sends the command to Woo, and updates its local projection only after a successful Woo read-back. Never independently write the same stock count to Woo and the 7Network stock ledger. The current Essentials by D live connection remains read-only under the user’s WordPress no-change instruction; enabling live write-back requires separate approval.

- Keep the first release owner/manager-only. Use a separate write-capable Woo key, enabled only for staging. Add an explicit connection capability and audit event for write access.
- Add a durable command/outbox keyed by tenant, connection, entity/variation, operation, and idempotency key. Record canonical payload hash, expected Woo revision/date_modified, actor, before/after snapshots, and queued/sent/accepted/unknown/conflict/rejected/reconciled states.
- Serialize writes per Woo product/variation. Before sending, re-read Woo and compare expected revision. If another editor changed it, return a conflict for staff review. After a timeout, read Woo before retrying; never blindly repeat an ambiguous stock adjustment.
- Start with separately enabled field groups: title/description/SKU/price; stock adjustments; product images; product/variation creation. Validate each against Woo staging before enabling the next group. Never change payment, refund, or order status through catalog write-back.
- Confirm conflict behavior under simultaneous Woo-admin and 7Network edits. A read-before-write check alone can race with an external editor; if the tested Woo API cannot enforce an atomic precondition, require a small Woo-side compare-and-set endpoint or keep the conflicted field Woo-only. Do not label best-effort checking as conflict-safe.
- Use read-back/webhook reconciliation as the only path that updates the local Woo projection. Keep external IDs immutable and recover unknown command outcomes before retrying.

Acceptance injects duplicate requests, delayed/duplicate webhook, timeout after Woo accepts a write, 401/403, rate limiting, SKU collision, simultaneous external edits, and app restart with queued commands. Verify no duplicate stock delta and no silent overwrite.

**Gate:** The staging-store owner signs off on one stock authority and conflict policy. Deploy first to disposable Woo staging; keep Essentials by D and any later production connection read-only until a separate owner-approved canary.

**Rollback:** Turn off write capability, stop the command worker, reconcile unknown commands against Woo, and return to read-only sync. Do not restore an older stock snapshot over newer Woo writes.

## 5. Fulfilment, finance, reports, and the notification outbox

### Fulfilment

Add carrier, tracking ID, validated tracking URL, dispatched/delivered timestamps, and last provider status to the existing order workflow. Manual courier entry is the first milestone; choose an automatic courier adapter only after Essentials by D names the provider and supplies a staging account. Normalize carrier events into the existing delivery state machine and deduplicate provider event IDs. Do not mark delivery complete from an unverified tracking page scrape.

### Documents and reports

Extend existing finance/document services for retail source orders. Generate a tenant-branded PDF invoice/receipt with stable number, order source, currency, tax/discount/shipping breakdown, and payment evidence from Woo. Only issue a receipt for confirmed payment. Reuse shared PDF/email/messaging infrastructure where compatible; do not duplicate training finance tables or mark a Woo order paid from 7Network.

Add reports by period, product/variation, channel, and staff. Attribute staff only from verified assignment or action; show imported online sales as Online / unattributed when Woo provides no reliable staff identity. Reconcile gross, discount, tax, shipping, refunds, and net totals to Woo.

### Repair the outbox before enabling messages

Patch the current shared worker on current main with targeted retail handlers. Preserve newer email, finance, training-report, and handoff behavior. Verify order creation/status updates do not invoke a rejected event kind, and event enqueue is idempotent. Staff alerts require the retail alert setting and entitlement. Customer updates require active, purpose-specific transactional consent for that order, a matching normalized destination hash, and the separate customer-update setting. Recheck eligibility, order state, and consent before dispatch; keep phone/email out of event payloads and logs.

Exercise queued, prepared, accepted, failed, unknown, retry, opt-out, consent withdrawal, duplicate status webhook, and tenant/role denial. A provider timeout remains unknown until reconciliation, not proof of delivery. Enable the worker only for a disposable/synthetic tenant until test email/WhatsApp deliveries and screen settings are accepted; real Essentials by D messages require a separate owner approval.

**Gate:** Essentials by D approves invoice numbering, tax display, receipt timing, courier mapping, report totals, and notification templates. Outbox and staging-provider acceptance pass before any customer order update is enabled. TFB provides its own approvals during its later rollout.

**Rollback:** Disable retail notifications and courier callbacks. Preserve event/delivery history and financial evidence. Roll back application code only; keep additive database history.

## 6. Consent-aware recovery, stock alerts, campaigns, and Meta

- Connector 1.0.1 has no checkout field hook. Its checkout event capture uses `woocommerce_checkout_update_order_review`, `woocommerce_checkout_create_order`, and `woocommerce_checkout_order_processed`; those hooks have only been verified for the classic checkout path. WooCommerce documents that not all shortcode checkout hooks run in Checkout Blocks and identifies Store API extension points. Inference from the plugin hooks and WooCommerce docs: do not promise Checkout Blocks event support. If Essentials by D uses Blocks, leave event capture disabled there or build and test a separate Store API/Blocks adapter: [WooCommerce checkout hook alternatives](https://developer.woocommerce.com/docs/block-development/reference/hooks/hook-alternatives/) and [Cart and Checkout extensibility](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/).
- Do not add a checkout field for this connector. Recovery messaging requires explicit permission collected through an approved existing channel, recorded for the stated recovery purpose. Do not treat transactional updates as blanket marketing permission. Store purpose, channel, source, timestamp, destination hash, withdrawal, and suppression state.
- Queue an abandoned-cart reminder only after an agreed delay and valid consent. Immediately before dispatch, recheck whether an order was paid/created, the cart was recovered, consent was withdrawn, the recipient opted out, or a suppression applies. Deduplicate by connection and cart/checkout ID.
- Implement low-stock staff alerts and back-in-stock customer alerts as separate event kinds. Recheck available stock and subscription/consent just before send; deduplicate per stock crossing and recipient.
- Use existing Meta, WhatsApp, templates, and campaign integrations where tenant permissions, channel consent, and provider state fit. Confirm whether the client means Meta messaging, ads, product catalog, or Instagram/Facebook Shop before scoping feed work. Do not claim Instagram Shop or Meta product-catalog sync from the current WhatsApp/Page integrations alone.
- Build audiences only from tenant-scoped, consented purchase data. Enforce suppression, opt-out, bounce/complaint, frequency caps, localized approved templates, and purchase recheck before each recovery send. Keep human review for initial campaigns.

Acceptance includes classic checkout with and without consent, recovery before/after paid order, abandoned then refunded order, consent withdrawal, duplicate event, out-of-stock/restock races, quiet hours, template rejection, Meta disconnect, and cross-tenant denial. Use synthetic/staging recipients only.

**Gate:** Essentials by D confirms classic checkout or funds a separately scoped Blocks implementation; templates, consent text, suppression rules, Meta permissions, and sender ownership are approved. Start with drafts and synthetic recipients; enable only bounded automation after acceptance and separate authorization for real sends.

## Ownership, subscription, and handover gate

Register each tenant’s WordPress/WooCommerce, Meta Business Manager, WhatsApp Business, email sender, courier, and other provider accounts in that tenant owner’s name. The owner initiates connections and retains owner/admin credentials and recovery access. 7Network stores only encrypted integration credentials required to operate the connection; staff access is role-scoped and audited. Remove implementation-team access at handover unless the tenant explicitly retains a support grant. Essentials by D is the first pilot; The Fabric Butik is a separate later onboarding.

The application code does not define annual pricing or support terms. Before handover, provide an itemized commercial schedule separating the 7Network annual subscription, one-time implementation, optional support/maintenance, hosting, and third-party/provider/message/courier charges. Do not promise all integrations, hosting, updates, or support are included until the contract states it. Demonstrate owner access, staff/role management, export, disconnect, key rotation, and offboarding.

## Deployment controls and acceptance record

- Use the established guarded release process. Deploy each increment to isolated staging first; apply reviewed additive migrations only after disposable-database rehearsal and verified backup/restore path.
- Do not release the Retail migrations until the pre-existing clean-chain blocker above is resolved and the full migration runner plus backup/restore rehearsal pass. The focused pair test does not clear this gate.
- Keep feature flags tenant-scoped. Start with the Essentials by D tenant, live data import explicitly approved by its owner, and no customer sends or Woo writes. The initial connector uses a read-only key. TFB onboarding remains a separate later rollout.
- Verify /user owner, accountant, manager, and agent views plus permitted/denied APIs; preserve Manage Plans and Manage Users. Verify English/Arabic, RTL, light/dark, loading/empty/error/denied/retry states, keyboard/touch, and widths 360, 390, 768, 1024, and 1440 CSS pixels.
- For PWA assets, verify install/navigation and cache versioning. Never cache private connector/customer/order API responses in a shared service worker. Offline or queued writes must not appear confirmed.
- After each production release, record source commit, image, overlay chain, migration/checksum, backup/rollback reference, API/browser/provider evidence, data reconciliation, and open gates in DEPLOYMENT.md. Roll back app code in reverse overlay order; do not restore an old database over new orders or stock.
- The user selected live Essentials by D (`essentialsbyd.com`) for the tenant owned by `admin@retail.com` and approved importing its data. Connector 1.0.1 is active with no checkout fields. MyFatoorah remains active, and its payment settings were not changed. The optional checkout-event endpoint is blank; no Woo API key, product/order/customer webhook, import, or customer message exists yet. The existing Abandoned Cart Lite for WooCommerce remains active; keep the two abandoned-checkout capture paths separate. The live `/user?page=retail-connected-stores` route still renders Dashboard because the production shell does not load `retail-workspace.js`; the review branch now carries forward the current live shell asset versions and adds that existing workspace loader. Deploy and verify the owner screen before entering the read-only key or starting sync.
