<?php
/**
 * Plugin Name: 7Network Retail Connector
 * Description: Signed, read-only order, customer, product and checkout event bridge for 7Network Retail & Inventory.
 * Version: 1.0.0
 * Requires Plugins: woocommerce
 * Requires PHP: 7.4
 * Text Domain: 7network-retail-connector
 */

if (!defined('ABSPATH')) { exit; }

final class SevenNetwork_Retail_Connector {
    const OPTION = '7network_retail_connector_settings';
    const CHECKOUT_PREFIX = '7network_checkout_';
    const RECOVERY_PREFIX = '7network_recovery_';
    const DELIVERY_PREFIX = '7network_delivery_';

    public static function init() {
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_post_7network_retail_save', [__CLASS__, 'save']);
        add_action('woocommerce_after_order_notes', [__CLASS__, 'checkout_consent_field']);
        add_action('woocommerce_checkout_update_order_review', [__CLASS__, 'capture_checkout']);
        add_action('woocommerce_checkout_create_order', [__CLASS__, 'attach_cart_to_order'], 10, 2);
        add_action('woocommerce_checkout_order_processed', [__CLASS__, 'checkout_recovered'], 10, 3);
        add_action('7network_retail_mark_abandoned', [__CLASS__, 'mark_abandoned']);
        add_action('7network_retail_retry_delivery', [__CLASS__, 'retry_delivery']);
        add_action('template_redirect', [__CLASS__, 'restore_cart'], 0);
    }

    private static function settings() {
        $value = get_option(self::OPTION, []);
        return is_array($value) ? $value : [];
    }

    public static function menu() {
        add_submenu_page('woocommerce', '7Network Connector', '7Network Connector', 'manage_woocommerce', '7network-retail-connector', [__CLASS__, 'settings_page']);
    }

    public static function settings_page() {
        if (!current_user_can('manage_woocommerce')) { return; }
        $settings = self::settings();
        ?>
        <div class="wrap">
            <h1>7Network Retail Connector</h1>
            <p>Configure the signed event endpoint from the 7Network Connected Stores screen. The connector only sends store data to that endpoint. It does not change WooCommerce products, stock, orders, payments or refunds.</p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <?php wp_nonce_field('7network_retail_save'); ?>
                <input type="hidden" name="action" value="7network_retail_save">
                <table class="form-table" role="presentation">
                    <tr><th scope="row"><label for="sevennetwork_endpoint">7Network signed webhook URL</label></th>
                        <td><input id="sevennetwork_endpoint" name="endpoint" type="url" class="regular-text" required value="<?php echo esc_attr($settings['endpoint'] ?? ''); ?>" placeholder="https://7network.live/api/retail-connectors/woocommerce/…">
                        <p class="description">HTTPS is required. Copy this endpoint and its secret from Retail &amp; Inventory → Connected Stores.</p></td></tr>
                    <tr><th scope="row"><label for="sevennetwork_secret">Webhook secret</label></th>
                        <td><input id="sevennetwork_secret" name="secret" type="password" class="regular-text" autocomplete="new-password" value="" placeholder="Leave blank to keep the current value">
                        <p class="description">The secret is stored in this WordPress site’s settings and is never shown after saving.</p></td></tr>
                </table>
                <?php submit_button('Save connector settings'); ?>
            </form>
        </div>
        <?php
    }

    public static function save() {
        if (!current_user_can('manage_woocommerce')) { wp_die('Forbidden', 403); }
        check_admin_referer('7network_retail_save');
        $endpoint = isset($_POST['endpoint']) ? esc_url_raw(wp_unslash($_POST['endpoint'])) : '';
        $secret = isset($_POST['secret']) ? sanitize_text_field(wp_unslash($_POST['secret'])) : '';
        $parsed = wp_parse_url($endpoint);
        $path = is_array($parsed) ? ($parsed['path'] ?? '') : '';
        $host = is_array($parsed) ? strtolower($parsed['host'] ?? '') : '';
        if (!$parsed || strtolower($parsed['scheme'] ?? '') !== 'https' || empty($parsed['host']) || !filter_var($parsed['host'], FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) ||
            isset($parsed['user']) || isset($parsed['pass']) || isset($parsed['query']) || isset($parsed['fragment']) || isset($parsed['port']) && (int)$parsed['port'] !== 443 ||
            !($host === '7network.live' || substr($host, -strlen('.7network.live')) === '.7network.live') ||
            !preg_match('#^/api/retail-connectors/woocommerce/[a-f0-9-]{36}$#i', $path)) {
            wp_die('A valid HTTPS endpoint is required.', 400);
        }
        $previous = self::settings();
        if ($secret === '') { $secret = (string)($previous['secret'] ?? ''); }
        if (strlen($secret) < 32 || strlen($secret) > 128) { wp_die('The webhook secret must be 32–128 characters.', 400); }
        update_option(self::OPTION, ['endpoint' => $endpoint, 'secret' => $secret], false);
        wp_safe_redirect(admin_url('admin.php?page=7network-retail-connector&saved=1'));
        exit;
    }

    public static function checkout_consent_field($checkout) {
        woocommerce_form_field('7network_checkout_followup_consent', [
            'type' => 'checkbox', 'class' => ['form-row-wide'], 'required' => false,
            'label' => 'I agree to receive a follow-up from this store about this unfinished checkout.',
        ], $checkout->get_value('7network_checkout_followup_consent'));
    }

    private static function parse_checkout_post($post_data) {
        $values = [];
        if (is_string($post_data)) { parse_str(wp_unslash($post_data), $values); }
        if (empty($values) && is_array($_POST)) { $values = wp_unslash($_POST); }
        return is_array($values) ? $values : [];
    }

    private static function cart_snapshot($values = []) {
        if (!function_exists('WC') || !WC()->cart || !WC()->session) { return null; }
        $items = [];
        foreach (WC()->cart->get_cart() as $item) {
            $product = $item['data'] ?? null;
            if (!$product || !$product->exists()) { continue; }
            $items[] = [
                'product_id' => (int)($item['product_id'] ?? 0),
                'variation_id' => (int)($item['variation_id'] ?? 0),
                'quantity' => max(1, (int)($item['quantity'] ?? 1)),
                'name' => sanitize_text_field($product->get_name()),
                'sku' => sanitize_text_field((string)$product->get_sku()),
            ];
        }
        if (!$items) { return null; }
        $cart_id = WC()->session->get('7network_retail_cart_id');
        if (!is_string($cart_id) || !preg_match('/^[a-f0-9-]{36}$/i', $cart_id)) {
            $cart_id = wp_generate_uuid4();
            WC()->session->set('7network_retail_cart_id', $cart_id);
        }
        $consent = !empty($values['7network_checkout_followup_consent']) && in_array((string)$values['7network_checkout_followup_consent'], ['1','yes','on'], true);
        $email = $consent ? sanitize_email($values['billing_email'] ?? '') : '';
        $phone = $consent ? sanitize_text_field($values['billing_phone'] ?? '') : '';
        $token = WC()->session->get('7network_retail_recovery_token');
        if (!is_string($token) || strlen($token) < 32) {
            $token = wp_generate_password(40, false, false);
            WC()->session->set('7network_retail_recovery_token', $token);
        }
        $recovery_key = self::RECOVERY_PREFIX . hash('sha256', $token);
        set_transient($recovery_key, ['cartId' => $cart_id, 'items' => $items], 7 * DAY_IN_SECONDS);
        $snapshot = [
            'id' => $cart_id,
            'status' => 'started',
            'currency' => get_woocommerce_currency(),
            'total' => (string)WC()->cart->get_total('edit'),
            'customer' => ['id' => null, 'email' => $email ?: null, 'phone' => $phone ?: null],
            'contactConsent' => $consent ? 'granted' : 'denied',
            'consentAt' => $consent ? gmdate('c') : null,
            'recoveryUrl' => add_query_arg('7network_recover', rawurlencode($token), wc_get_checkout_url()),
            'lineItems' => $items,
            'createdAt' => gmdate('c'),
            'updatedAt' => gmdate('c'),
        ];
        set_transient(self::CHECKOUT_PREFIX . md5($cart_id), $snapshot, 3 * DAY_IN_SECONDS);
        return $snapshot;
    }

    public static function capture_checkout($post_data) {
        $snapshot = self::cart_snapshot(self::parse_checkout_post($post_data));
        if (!$snapshot) { return; }
        self::send_event('checkout.started', $snapshot);
        $args = [$snapshot['id']];
        wp_clear_scheduled_hook('7network_retail_mark_abandoned', $args);
        wp_schedule_single_event(time() + HOUR_IN_SECONDS, '7network_retail_mark_abandoned', $args);
    }

    public static function attach_cart_to_order($order, $data) {
        if (!$order || !function_exists('WC') || !WC()->session) { return; }
        $cart_id = WC()->session->get('7network_retail_cart_id');
        if (is_string($cart_id) && preg_match('/^[a-f0-9-]{36}$/i', $cart_id)) { $order->update_meta_data('_7network_retail_cart_id', $cart_id); }
        $consent = !empty($data['7network_checkout_followup_consent']) && in_array((string)$data['7network_checkout_followup_consent'], ['1','yes','on'], true);
        $order->update_meta_data('_7network_retail_followup_consent', $consent ? 'granted' : 'denied');
        if ($consent) { $order->update_meta_data('_7network_retail_followup_consent_at', gmdate('c')); }
    }

    public static function mark_abandoned($cart_id) {
        $snapshot = get_transient(self::CHECKOUT_PREFIX . md5((string)$cart_id));
        if (!is_array($snapshot)) { return; }
        $snapshot['status'] = 'abandoned';
        $snapshot['updatedAt'] = gmdate('c');
        self::send_event('checkout.abandoned', $snapshot);
        set_transient(self::CHECKOUT_PREFIX . md5((string)$cart_id), $snapshot, 3 * DAY_IN_SECONDS);
    }

    public static function checkout_recovered($order_id, $posted_data, $order) {
        if (!$order || !is_a($order, 'WC_Order')) { $order = wc_get_order($order_id); }
        if (!$order) { return; }
        $cart_id = (string)$order->get_meta('_7network_retail_cart_id');
        if (!preg_match('/^[a-f0-9-]{36}$/i', $cart_id)) { return; }
        $snapshot = get_transient(self::CHECKOUT_PREFIX . md5($cart_id));
        if (!is_array($snapshot)) { return; }
        $snapshot['status'] = 'recovered';
        $snapshot['order_id'] = (string)$order_id;
        $snapshot['contactConsent'] = $order->get_meta('_7network_retail_followup_consent') ?: 'unknown';
        $snapshot['consentAt'] = $order->get_meta('_7network_retail_followup_consent_at') ?: null;
        $snapshot['updatedAt'] = gmdate('c');
        self::send_event('checkout.recovered', $snapshot);
        wp_clear_scheduled_hook('7network_retail_mark_abandoned', [$cart_id]);
        delete_transient(self::CHECKOUT_PREFIX . md5($cart_id));
        if (function_exists('WC') && WC()->session) {
            WC()->session->__unset('7network_retail_cart_id');
            WC()->session->__unset('7network_retail_recovery_token');
        }
    }

    public static function restore_cart() {
        if (empty($_GET['7network_recover']) || !function_exists('WC') || !WC()->cart) { return; }
        $token = sanitize_text_field(wp_unslash($_GET['7network_recover']));
        if (strlen($token) < 32 || strlen($token) > 64 || !preg_match('/^[A-Za-z0-9]+$/', $token)) { return; }
        $key = self::RECOVERY_PREFIX . hash('sha256', $token);
        $stored = get_transient($key);
        $items = is_array($stored['items'] ?? null) ? $stored['items'] : $stored;
        if (!is_array($items) || !$items) { return; }
        nocache_headers();
        header('Referrer-Policy: no-referrer');
        foreach ($items as $item) {
            $product_id = absint($item['product_id'] ?? 0);
            $variation_id = absint($item['variation_id'] ?? 0);
            $quantity = min(99, max(1, absint($item['quantity'] ?? 1)));
            if ($product_id && wc_get_product($variation_id ?: $product_id)) { WC()->cart->add_to_cart($product_id, $quantity, $variation_id); }
        }
        if (is_array($stored) && !empty($stored['cartId']) && preg_match('/^[a-f0-9-]{36}$/i', $stored['cartId']) && WC()->session) {
            WC()->session->set('7network_retail_cart_id', $stored['cartId']);
        }
        delete_transient($key);
        wp_safe_redirect(wc_get_checkout_url());
        exit;
    }

    private static function send_event($type, $snapshot) {
        $settings = self::settings();
        $endpoint = $settings['endpoint'] ?? '';
        $secret = $settings['secret'] ?? '';
        if (!$endpoint || !$secret) { return false; }
        $payload = wp_json_encode(['type' => $type, 'data' => $snapshot]);
        if (!is_string($payload)) { return false; }
        return self::deliver(['id' => wp_generate_uuid4(), 'type' => $type, 'payload' => $payload, 'attempt' => 0]);
    }

    private static function deliver($event) {
        $settings = self::settings();
        $endpoint = $settings['endpoint'] ?? '';
        $secret = $settings['secret'] ?? '';
        if (!$endpoint || !$secret) { return false; }
        $signature = base64_encode(hash_hmac('sha256', $event['payload'], $secret, true));
        $response = wp_remote_post($endpoint, [
            'timeout' => 8, 'redirection' => 0, 'blocking' => true, 'sslverify' => true,
            'headers' => ['Content-Type' => 'application/json', 'X-7Network-Event' => $event['type'],
                'X-7Network-Resource' => 'checkout', 'X-7Network-Signature' => $signature],
            'body' => $event['payload'],
        ]);
        if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) >= 200 && wp_remote_retrieve_response_code($response) < 300) {
            delete_transient(self::DELIVERY_PREFIX . md5($event['id']));
            return true;
        }
        $event['attempt']++;
        if ($event['attempt'] <= 5) {
            set_transient(self::DELIVERY_PREFIX . md5($event['id']), $event, DAY_IN_SECONDS);
            wp_schedule_single_event(time() + min(HOUR_IN_SECONDS, 30 * (2 ** $event['attempt'])), '7network_retail_retry_delivery', [$event['id']]);
        }
        return false;
    }

    public static function retry_delivery($event_id) {
        $event = get_transient(self::DELIVERY_PREFIX . md5((string)$event_id));
        if (is_array($event) && isset($event['payload'], $event['type'], $event['attempt'])) { self::deliver($event); }
    }
}

SevenNetwork_Retail_Connector::init();
