=== 7Network Retail Connector ===
Contributors: 7network
Tags: woocommerce, retail, webhooks
Requires at least: 6.2
Requires PHP: 7.4
Stable tag: 1.0.1
License: ISC

Connects signed WooCommerce checkout-started, abandoned and recovered events to 7Network Retail & Inventory. Version 1.0.1 adds no fields, scripts, notices or other visible controls to the storefront or checkout. It does not change payment gateways, product prices, stock, order totals, payments or refunds. It stores a private cart-correlation ID on an order for checkout recovery. The included connector is provided under the same ISC license as the 7Network application.

Installation
1. In WordPress, open Plugins > Add New Plugin > Upload Plugin.
2. Upload 7network-retail-connector.zip and activate it.
3. In WooCommerce > 7Network Connector, enter the signed endpoint and webhook secret shown in the 7Network Connected Stores screen.
4. Save. In the same 7Network screen, configure the listed standard WooCommerce webhooks using the same endpoint and secret.

Checkout and payment behavior
The plugin adds no checkout fields, payment methods, scripts or notices. It does not modify the checkout page, order form, payment gateway settings or refund behavior. Optional checkout event payloads always omit customer email and phone and report follow-up consent as denied because this version does not collect consent on checkout. Checkout events are sent only when an endpoint and secret are configured. The plugin does not send customer messages. WooCommerce Checkout Blocks require no special support because the plugin adds no checkout UI.

Events are signed using HMAC-SHA256 and retried up to five times when 7Network is unavailable. Recovery tokens are random, short-lived and single use. Checkout event payloads contain cart lines and status only; no customer contact details or consent is collected, and no customer notifications are sent.
