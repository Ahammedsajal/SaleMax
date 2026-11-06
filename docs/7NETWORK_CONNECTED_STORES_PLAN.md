# 7Network Connected Stores in Retail & Inventory

Updated 6 November 2026. This extends the existing private `retail_boutique@1` category and business panel. The application code and migration are deployed behind closed entitlement/provider gates; no merchant connection is active. See `DEPLOYMENT.md` for the live release and rollback evidence.

## Product outcome

Give a retail business one owner-only view of orders, payment/refund evidence, customers, products and abandoned checkouts from Shopify and WooCommerce. The connected-store view sits inside the existing Retail & Inventory area and uses the existing business session, tenant boundary, owner permission, language, theme and application shell.

Imported store data remains a separate source ledger. It does not create 7Network storefront orders, reserve stock, edit source products, send customer messages, reconcile cash, create accounting journals, initiate payments or issue refunds. Owners can later choose a separately scoped workflow to map imported items to the 7Network catalogue and inventory; automatic matching is deliberately excluded from the first release.

## Provider coverage

The first release permits one connection per provider store domain across the platform. A provider shop cannot be attached to two 7Network tenants; this keeps webhook routing and privacy compliance requests unambiguous. Product image previews use the source store's HTTPS image URL in the authenticated panel; 7Network does not mirror merchant images in this increment.

| Data/workflow | Shopify | WooCommerce |
|---|---|---|
| Products/customers/orders | GraphQL Admin API with read-only scopes and paginated manual import | REST API v3 with a dedicated read-only consumer key over HTTPS and paginated manual import |
| Updates after import | HMAC-signed order, payment, refund, customer, product and app webhooks | HMAC-signed order, customer and product webhooks |
| Payment/refund data | Order transaction/refund records are imported as provider evidence | Order transaction ID and refund records are imported as provider evidence |
| Abandoned checkout | `abandonedCheckouts` query; requires `read_orders` and the authorizing Shopify user’s abandoned-checkout permission | Optional 7Network WordPress connector captures checkout events after the buyer reaches the classic checkout; customer contact is sent only after explicit follow-up consent |
| Privacy lifecycle | Configure the three required compliance webhook topics in the Shopify Dev Dashboard; customer export package and redaction handling are owner reviewed | Owner can disconnect, then erase imported records after typing the exact store domain |

Shopify’s `read_orders` scope covers the last 60 days by default. The optional `read_all_orders` scope must remain disabled until Shopify approves the app, then be enabled in `SALEMAX_SHOPIFY_READ_ALL_ORDERS` and reauthorized. Protected customer data is reviewed separately from scopes. Abandoned checkout visibility also depends on the authorizing staff account’s permission. See the official [Shopify access scope reference](https://shopify.dev/docs/api/usage/access-scopes) and [AbandonedCheckout reference](https://shopify.dev/docs/api/admin-graphql/latest/objects/AbandonedCheckout).

## Data and security design

- Each provider connection is tenant-scoped. Provider credentials, customer/order/checkout snapshots, recovery URLs and raw event payloads use AES-256-GCM with tenant, connection and record identity in the authenticated additional data.
- OAuth state is random, hashed at rest, one-use, short-lived, tenant-bound and actor-bound. Shopify webhooks and Woo webhooks are verified against the exact raw request body before processing.
- Provider requests use HTTPS, bounded response sizes and timeouts, reject redirects, and pin DNS to public IPv4 addresses to limit SSRF and DNS-rebinding risk.
- Webhooks are idempotent by provider delivery ID. Successful and failed-event raw payloads are erased; failed events retain only delivery metadata while the provider retries.
- Customer and payment fields returned to the browser are owner-only. Provider marketing consent, the explicit Woo follow-up consent and 7Network outbound notification consent are distinct values; a provider email-marketing preference never authorizes a 7Network message.
- Product/order/payment imports never write to the 7Network inventory ledger or accounting ledger. Payment state is labeled as reported by the connected store, not independently settled by 7Network.
- Disconnect revokes credentials and retains imported records for owner reference. After disconnect, the owner can permanently erase imported orders, payment/refund evidence, customers, products, checkouts, privacy requests and event logs; the connection metadata and audit record remain.
- Shopify uses conservative nested connection page sizes to stay within GraphQL query-cost limits. The owner view flags orders, products or checkouts whose nested line items, payment transactions or variants exceed that first page. Full nested pagination or bulk import remains a production gate for stores with large records; it never reports a truncated record as complete.

## Local implementation shape

- Owner screen: `Connected Stores` in the existing business panel, under the current Retail & Inventory capability.
- Shared API: `/api/workspace/retail/connectors` using the current business session/context adapter.
- Provider callbacks: `/api/retail-connectors` for signed provider events and Shopify OAuth.
- Additive schema: `20270132_retail_connected_stores.sql`.
- Woo checkout connector: `integrations/woocommerce/7network-retail-connector.zip` packages `integrations/woocommerce/7network-retail-connector/7network-connector.php` and its install notes. The optional plugin supports classic checkout hooks; WooCommerce Checkout Blocks are not supported by this first version and require a separate extension implementation. Regenerate the archive after changing plugin files.
- Configuration: blank `SALEMAX_SHOPIFY_CLIENT_ID` and `SALEMAX_SHOPIFY_CLIENT_SECRET`; pinned GraphQL version `2026-10`; optional historical orders scope disabled by default.

## Rollout plan

1. **Source readiness:** finish provider schema and query review, current API/payload review, permission boundaries, tenant isolation, duplicate delivery and failure recovery behavior. Run meaningful disposable-database and concurrency checks before declaring the source increment complete.
2. **Provider readiness:** configure the Shopify app callback at `https://7network.live/api/retail-connectors/shopify/callback`, add the client credentials to the protected production environment, receive required scope/protected-customer-data approvals, configure the mandatory static privacy webhook endpoint, and set the approved API version. For WooCommerce, produce a read-only REST key and configure each signed webhook; the merchant installs the optional plugin only if they want abandoned checkout capture.
3. **Staging:** production migration 32 is applied through the existing migration ledger, and its nine connector tables are empty. Before connecting a merchant, verify fresh/upgrade migration behavior in staging, connect synthetic Shopify and Woo stores, and exercise pagination, webhook retries, duplicate deliveries, customer data requests/redaction, disconnect and owner erase.
4. **Acceptance:** sign in as a pilot owner; verify staff/agent denial, two-tenant isolation, imported orders/payments/customers/products/checkouts, manual sync and webhook updates, explicit checkout consent, Arabic/RTL, English, light/dark, keyboard/screen reader states, mobile/tablet/desktop, installed PWA and offline/update behavior.
5. **Operations:** complete custom-domain TLS where applicable, provider rate-limit monitoring, alerting and runbooks, load/restore rehearsal, privacy/export retention policy and pilot approval. Deploy the verified source, record migration, release, rollback and health evidence in `DEPLOYMENT.md`, then roll out to selected merchants. Keep public storefront activation and online payment/refund/accounting posting separately gated.

## Current gates

The source and migration are committed, pushed and deployed; however, no Shopify app credentials or protected-data approvals are configured, no Woo merchant key/plugin pilot is connected, and no signed-in owner/staff or two-tenant acceptance has been completed. The page remains inaccessible to business tenants until a reviewed commerce plan is assigned. The privacy export package deliberately fails instead of silently truncating when a customer has more than 5,000 imported orders or checkouts; larger exports need an asynchronous, paginated export job before production acceptance. The optional Woo plugin does not support Checkout Blocks. No automated provider imports, payment capture/refund, accounting posting, inventory update or customer outreach occurs.

Do not mark this integration or the wider retail rollout complete until these gates and the existing retail plan’s open finance, PWA, accessibility, custom-domain TLS and load/restore work are verified.
