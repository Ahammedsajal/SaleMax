<?php
declare(strict_types=1);

// Standalone synthetic harness for the supplied WordPress plugin. It exercises
// hooks and signed events without WordPress, WooCommerce, or a live store.
define('ABSPATH', '/synthetic-wordpress/');
define('DAY_IN_SECONDS', 86400);
define('HOUR_IN_SECONDS', 3600);

$GLOBALS['sevennetwork_actions'] = [];
$GLOBALS['sevennetwork_transients'] = [];
$GLOBALS['sevennetwork_scheduled'] = [];
$GLOBALS['sevennetwork_requests'] = [];
$GLOBALS['sevennetwork_settings'] = ['endpoint' => '', 'secret' => ''];
$GLOBALS['sevennetwork_response_code'] = 200;
$GLOBALS['sevennetwork_uuid'] = 0;

function sevennetwork_assert(bool $condition, string $message): void {
    if (!$condition) { throw new RuntimeException($message); }
}
function add_action(string $name, $callback, int $priority = 10, int $acceptedArgs = 1): void {
    $GLOBALS['sevennetwork_actions'][$name][] = [$callback, $priority, $acceptedArgs];
}
function add_submenu_page(...$args): void {}
function get_option(string $name, $default = false) { return $GLOBALS['sevennetwork_settings']; }
function WC() { return $GLOBALS['sevennetwork_woo']; }
function get_woocommerce_currency(): string { return 'QAR'; }
function wc_get_checkout_url(): string { return 'https://shop.example.invalid/checkout/'; }
function wc_get_product(int $id) { return $id > 0 ? new SevenNetwork_Test_Product() : null; }
function wp_generate_uuid4(): string {
    $GLOBALS['sevennetwork_uuid']++;
    return sprintf('00000000-0000-4000-8000-%012d', $GLOBALS['sevennetwork_uuid']);
}
function wp_generate_password(int $length, bool $specialChars = true, bool $extraSpecialChars = false): string { return str_repeat('T', $length); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function wp_unslash($value) { return $value; }
function wp_json_encode($value): string|false { return json_encode($value, JSON_UNESCAPED_SLASHES); }
function add_query_arg(string $key, string $value, string $url): string { return $url . '?' . rawurlencode($key) . '=' . rawurlencode($value); }
function set_transient(string $key, $value, int $expiration = 0): bool { $GLOBALS['sevennetwork_transients'][$key] = $value; return true; }
function get_transient(string $key) { return $GLOBALS['sevennetwork_transients'][$key] ?? false; }
function delete_transient(string $key): bool { unset($GLOBALS['sevennetwork_transients'][$key]); return true; }
function wp_clear_scheduled_hook(string $hook, array $args = []): int { return 0; }
function wp_schedule_single_event(int $timestamp, string $hook, array $args = []): bool {
    $GLOBALS['sevennetwork_scheduled'][] = [$timestamp, $hook, $args];
    return true;
}
function wp_remote_post(string $url, array $args): array {
    $GLOBALS['sevennetwork_requests'][] = [$url, $args];
    return ['response' => ['code' => $GLOBALS['sevennetwork_response_code']]];
}
function is_wp_error($value): bool { return false; }
function wp_remote_retrieve_response_code(array $value): int { return (int)($value['response']['code'] ?? 0); }

final class SevenNetwork_Test_Product {
    public function exists(): bool { return true; }
    public function get_name(): string { return 'Synthetic Linen'; }
    public function get_sku(): string { return 'SYN-LINEN-M'; }
}
final class SevenNetwork_Test_Cart {
    public function get_cart(): array {
        return [['product_id' => 101, 'variation_id' => 202, 'quantity' => 2, 'data' => new SevenNetwork_Test_Product()]];
    }
    public function get_total(string $context): string { return '125.50'; }
    public function add_to_cart(...$args): bool { return true; }
}
final class SevenNetwork_Test_Session {
    private array $values = [];
    public function get(string $key) { return $this->values[$key] ?? null; }
    public function set(string $key, $value): void { $this->values[$key] = $value; }
    public function __unset(string $key): void { unset($this->values[$key]); }
}
final class SevenNetwork_Test_Woo {
    public SevenNetwork_Test_Cart $cart;
    public SevenNetwork_Test_Session $session;
    public function __construct() { $this->cart = new SevenNetwork_Test_Cart(); $this->session = new SevenNetwork_Test_Session(); }
}
final class WC_Order {
    private array $meta = [];
    public function update_meta_data(string $key, $value): void { $this->meta[$key] = $value; }
    public function get_meta(string $key): string { return (string)($this->meta[$key] ?? ''); }
}

$GLOBALS['sevennetwork_woo'] = new SevenNetwork_Test_Woo();
require __DIR__ . '/../integrations/woocommerce/7network-retail-connector/7network-connector.php';

$hooks = array_keys($GLOBALS['sevennetwork_actions']);
sevennetwork_assert(in_array('woocommerce_checkout_update_order_review', $hooks, true), 'classic checkout capture hook missing');
sevennetwork_assert(in_array('woocommerce_checkout_create_order', $hooks, true), 'order correlation hook missing');
sevennetwork_assert(in_array('woocommerce_checkout_order_processed', $hooks, true), 'recovery hook missing');
foreach (['woocommerce_after_order_notes', 'woocommerce_checkout_fields', 'woocommerce_before_checkout_form',
          'woocommerce_available_payment_gateways', 'woocommerce_payment_gateways'] as $forbiddenHook) {
    sevennetwork_assert(!in_array($forbiddenHook, $hooks, true), 'forbidden checkout/payment hook registered: ' . $forbiddenHook);
}
$pluginSource = file_get_contents(__DIR__ . '/../integrations/woocommerce/7network-retail-connector/7network-connector.php');
sevennetwork_assert(is_string($pluginSource), 'plugin source unavailable');
foreach (['woocommerce_form_field', 'woocommerce_checkout_fields', 'woocommerce_after_order_notes', 'wp_mail'] as $forbiddenSource) {
    sevennetwork_assert(!str_contains($pluginSource, $forbiddenSource), 'field/message code found: ' . $forbiddenSource);
}

SevenNetwork_Retail_Connector::capture_checkout();
sevennetwork_assert(count($GLOBALS['sevennetwork_requests']) === 0, 'events must remain disabled without an endpoint');
sevennetwork_assert(count($GLOBALS['sevennetwork_scheduled']) === 1, 'classic checkout should schedule a synthetic abandonment check');

$secret = str_repeat('synthetic-secret-', 3);
$GLOBALS['sevennetwork_settings'] = ['endpoint' => 'https://7network.live/api/retail-connectors/woocommerce/00000000-0000-4000-8000-000000000001', 'secret' => $secret];
SevenNetwork_Retail_Connector::capture_checkout();
sevennetwork_assert(count($GLOBALS['sevennetwork_requests']) === 1, 'configured checkout should send a signed event');
[$url, $request] = $GLOBALS['sevennetwork_requests'][0];
sevennetwork_assert(str_starts_with($url, 'https://7network.live/api/retail-connectors/woocommerce/'), 'unexpected event endpoint');
$payload = json_decode((string)$request['body'], true, 32, JSON_THROW_ON_ERROR);
sevennetwork_assert(($payload['type'] ?? null) === 'checkout.started', 'wrong started event type');
sevennetwork_assert(($payload['data']['lineItems'][0]['product_id'] ?? null) === 101, 'source product ID missing');
sevennetwork_assert(($payload['data']['lineItems'][0]['variation_id'] ?? null) === 202, 'source variation ID missing');
sevennetwork_assert(($payload['data']['customer']['email'] ?? null) === null && ($payload['data']['customer']['phone'] ?? null) === null,
    'checkout payload must not contain customer contact details');
sevennetwork_assert(($payload['data']['contactConsent'] ?? null) === 'denied', 'plugin must not assert contact consent');
$signature = base64_encode(hash_hmac('sha256', (string)$request['body'], $secret, true));
sevennetwork_assert(($request['headers']['X-7Network-Signature'] ?? null) === $signature, 'event HMAC signature mismatch');
sevennetwork_assert(($request['headers']['X-7Network-Event'] ?? null) === 'checkout.started', 'event header mismatch');

$cartId = $GLOBALS['sevennetwork_woo']->session->get('7network_retail_cart_id');
sevennetwork_assert(is_string($cartId) && preg_match('/^[a-f0-9-]{36}$/i', $cartId) === 1, 'cart correlation ID invalid');
SevenNetwork_Retail_Connector::mark_abandoned($cartId);
sevennetwork_assert(count($GLOBALS['sevennetwork_requests']) === 2, 'abandoned event missing');
$abandoned = json_decode((string)$GLOBALS['sevennetwork_requests'][1][1]['body'], true, 32, JSON_THROW_ON_ERROR);
sevennetwork_assert(($abandoned['type'] ?? null) === 'checkout.abandoned', 'wrong abandoned event type');

$GLOBALS['sevennetwork_response_code'] = 503;
SevenNetwork_Retail_Connector::mark_abandoned($cartId);
sevennetwork_assert(count($GLOBALS['sevennetwork_requests']) === 3, 'retry fixture did not send failure response');
$retryEvents = array_values(array_filter($GLOBALS['sevennetwork_scheduled'], static fn($row) => $row[1] === '7network_retail_retry_delivery'));
sevennetwork_assert(count($retryEvents) === 1, 'failed delivery did not schedule bounded retry');
$retryKey = '7network_delivery_' . md5($retryEvents[0][2][0]);
$queued = $GLOBALS['sevennetwork_transients'][$retryKey] ?? null;
sevennetwork_assert(is_array($queued) && ($queued['attempt'] ?? null) === 1, 'retry attempt was not persisted');
$GLOBALS['sevennetwork_response_code'] = 200;
SevenNetwork_Retail_Connector::retry_delivery($retryEvents[0][2][0]);
sevennetwork_assert(count($GLOBALS['sevennetwork_requests']) === 4, 'queued retry was not delivered');
sevennetwork_assert(!isset($GLOBALS['sevennetwork_transients'][$retryKey]), 'successful retry was not cleared');

$order = new WC_Order();
SevenNetwork_Retail_Connector::attach_cart_to_order($order);
sevennetwork_assert($order->get_meta('_7network_retail_cart_id') === $cartId, 'order/cart correlation was not stored');
SevenNetwork_Retail_Connector::checkout_recovered(303, null, $order);
sevennetwork_assert(count($GLOBALS['sevennetwork_requests']) === 5, 'recovered event missing');
$recovered = json_decode((string)$GLOBALS['sevennetwork_requests'][4][1]['body'], true, 32, JSON_THROW_ON_ERROR);
sevennetwork_assert(($recovered['type'] ?? null) === 'checkout.recovered', 'wrong recovered event type');
sevennetwork_assert(($recovered['data']['order_id'] ?? null) === '303', 'recovered order ID missing');
sevennetwork_assert(($recovered['data']['contactConsent'] ?? null) === 'denied', 'recovered event must keep follow-up consent denied');

echo json_encode(['classicCheckoutHooks' => true, 'checkoutAndPaymentFields' => false, 'hmacVerified' => true,
    'contactConsent' => 'denied', 'customerContactIncluded' => false, 'events' => ['started', 'abandoned', 'recovered'],
    'failureRetryQueued' => true, 'liveWordPressOrWooUsed' => false], JSON_UNESCAPED_SLASHES) . PHP_EOL;
