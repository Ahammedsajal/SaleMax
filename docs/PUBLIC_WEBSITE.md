# SaleMaX public website

The existing Node application serves an English-first public document at `/`, with Arabic available through `?lang=ar`. The source is maintained in `client/public/website/`. This replaces the public landing content only; the existing compiled `/admin`, `/user`, agent, checkout and legal-page application remains intact. Tenant custom-domain requests keep their existing routing. No minified application logic is edited.

The visual direction adapts the service discovery, guided enquiry and animated depth of the owner-supplied Fudex reference, using original SaleMaX copy and category-supported capabilities. It does not import Fudex trademarks, statistics, Saudi pricing, ERP, hosting or venture-service claims. Product previews are explicitly illustrative. No remote fonts, new frontend framework or runtime library is needed. Animation uses CSS transforms/opacity, viewport entry and reduced-motion preferences. Tabs support arrow/Home/End navigation; forms retain labelled validation, busy, error, retry and success states.

## Existing systems reused

- Pricing reads the existing `/api/admin/get_plans` and `/api/web/get_web_public` endpoints. Plan IDs, prices, currency, durations, limits and `/user/checkout?product=<id>` links remain authoritative; no second catalogue is created.
- `POST /api/public/website/enquiries` creates a record in the current `contact_form` list and an opportunity through the existing `createManualLead` service. The existing `/api/web/submit_contact_form` endpoint is compatibly intercepted as well.
- Admin finds requests in **Contact Leads**. The designated SaleMaX Sales owner finds them in **Lead Pipeline**, initially unassigned, with `public_form` source, contact details, business/solution title and the full enquiry in activity. Staff access and subsequent assignment use the current Pipeline permissions; no tenant or role access is expanded.
- Routing resolves an active verified owner in the first-party `salemax_sales` tenant. `SALEMAX_WEBSITE_SALES_TENANT_SLUG` can explicitly designate the deployment's tenant; its default is the verified existing first-party slug. Caller-supplied tenant or owner IDs are ignored. Missing/ambiguous/inactive ownership fails closed without saving either record.
- Both business writes and the request reference commit atomically. A UUID request key and payload hash serialize concurrent retries. Changed requests reject a reused key. Transient InnoDB deadlock/lock-timeout errors receive at most three transaction attempts. The public response contains a request reference, never tenant/lead/contact IDs.
- Origin checks, a 16 KB parser limit, field limits, consent, a honeypot and HMAC-based eight-per-hour visitor buckets protect intake. The final nginx forwarding entry is trusted only from the local/private proxy. Rate buckets older than 48 hours are pruned in bounded batches. These controls do not claim CAPTCHA-level bot prevention.
- No email, WhatsApp campaign, provider message or payment is initiated by enquiry submission.

## Validation and release

`node --test tests/website-enquiries.test.js tests/pipeline-contacts.test.js` covers HTTP/validation and existing contact behavior. `tests/website-enquiries.integration.cjs` requires an empty disposable `sx_website_test` MariaDB database and tests the actual Pipeline service, concurrent retries, rollback on downstream failure, stale payloads, inactive routing, rate limits and Arabic data. It refuses another database name.

Use `scripts/deploy-public-website-overlay.cjs <copied-live-release> <reviewed-artifact>` to extend the resolved live release. It preserves newer production modules and generated frontend files, derives the one-line mount and full-enquiry Pipeline formatter from maintained source, and updates the existing Pipeline cache reference. Build from the active app image, run the new migration through the current ledger, switch only the app after health checks, and record hashes/rollback and authenticated acceptance in `DEPLOYMENT.md`.

The linked legacy privacy and terms pages currently contain placeholder content. Their legally operative text needs the business owner's review; this website release preserves their existing destinations and provides an explicit enquiry-use notice and contact consent. It does not invent commercial terms or present consent as a marketing subscription. The full 42-ticket platform upgrade and its provider/finance/load/restore gates remain independently tracked.
