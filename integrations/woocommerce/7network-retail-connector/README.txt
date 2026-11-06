=== 7Network Retail Connector ===
Contributors: 7network
Tags: woocommerce, retail, checkout recovery
Requires at least: 6.2
Requires PHP: 7.4
Stable tag: 1.0.0
License: ISC

Connects WooCommerce checkout-started, abandoned and recovered events to 7Network Retail & Inventory. It does not modify WooCommerce products, orders, stock, payments or refunds. The included connector is provided under the same ISC license as the 7Network application.

Installation
1. In WordPress, open Plugins > Add New Plugin > Upload Plugin.
2. Upload 7network-retail-connector.zip and activate it.
3. In WooCommerce > 7Network Connector, enter the signed endpoint and webhook secret shown in the 7Network Connected Stores screen.
4. Save. In the same 7Network screen, configure the listed standard WooCommerce webhooks using the same endpoint and secret.

Consent and checkout support
The plugin adds an unchecked checkout follow-up consent field. It sends checkout email and phone only when the buyer opts in. Without consent it sends checkout status, product lines and recovery data without contact details. Capture starts after the buyer reaches classic checkout and triggers an order-review update. WooCommerce Checkout Blocks are not supported by version 1.0.0.

Events are signed using HMAC-SHA256 and retried up to five times when 7Network is unavailable. Recovery tokens are random, short-lived and single use. The plugin does not send customer notifications; the opt-in is imported as consent evidence for a future, separately approved workflow.
