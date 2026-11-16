import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'retail_connected_stores_release', ROOT / 'deploy/retail-connected-stores-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class RetailConnectedStoresReleaseTests(unittest.TestCase):
    def test_index_adds_only_the_existing_workspace_loader(self):
        source = b'<head><script defer src="/business-inventory.js?v=1"></script></head>'
        updated = release.prepare_index(source)
        self.assertEqual(updated.count(b'retail-workspace.js?v='), 1)
        self.assertIn(b'retail-workspace.js?v=20261116-essentials-admin1', updated)
        self.assertEqual(updated.replace(release.INDEX_INSERT, release.INDEX_MARKER), source)

    def test_woo_copy_keeps_checkout_plugin_unconfigured_and_checkout_free(self):
        source = """t('Connect your existing Shopify or WooCommerce store. Imported data stays in this business workspace; it does not change 7Network stock, fulfilment, accounting or customer messages.','old Arabic');
t('Create a dedicated read-only WooCommerce REST API key over HTTPS. Checkout abandonment capture uses the optional 7Network plugin; standard WooCommerce webhooks keep orders, customers and products current.','old Arabic');
add(oneTime,'h3',t('Save this webhook secret now','old Arabic'));
add(oneTime,'p',t('Use it for the WooCommerce order/customer/product webhooks and the abandoned-checkout plugin. You can reveal it later from the setup panel, and the value is never saved in this browser.','old Arabic'));
status.textContent=t('WooCommerce connected. Set up its signed webhooks next.','old Arabic');
if(result.abandonedCheckoutPlugin){const link=add(area,'a',t('Download the WooCommerce abandoned-checkout plugin','old Arabic'));link.href=result.abandonedCheckoutPlugin;}
add(area,'p',t('In WooCommerce, create active webhooks for the listed topics. Install the downloaded plugin ZIP in WordPress and activate it; then put the signed endpoint and secret into its settings for checkout events. Import remains read only. The plugin supports classic checkout, not Checkout Blocks.','old Arabic'));""".encode()
        updated = release.prepare_retail_js(source).decode()
        self.assertIn('does not edit storefront pages, checkout, payment settings', updated)
        self.assertIn('dedicated read-only WooCommerce REST key', updated)
        self.assertIn('API credentials were cleared from the form and stored encrypted', updated)
        self.assertIn("if(result.abandonedCheckoutPlugin&&connection.provider!=='woocommerce')", updated)
        self.assertNotIn('Install the downloaded plugin ZIP in WordPress', updated)
        self.assertIn('حقول الدفع', updated)

    def test_changed_preimages_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'insertion point changed'):
            release.prepare_index(b'<head></head>')
        with self.assertRaisesRegex(RuntimeError, 'connection scope copy'):
            release.prepare_retail_js(b"t('unexpected','text');")


if __name__ == '__main__':
    unittest.main()
