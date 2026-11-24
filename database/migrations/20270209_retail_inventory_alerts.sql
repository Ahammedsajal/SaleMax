-- Retail alert delivery is opt-in. Inventory state is recorded independently
-- so enabling alerts can safely reconcile existing configured thresholds.
ALTER TABLE sx_business_notification_settings
  ADD COLUMN retail_inventory_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER retail_customer_updates_enabled;

ALTER TABLE sx_business_notification_events
  MODIFY kind ENUM('invoice_issued','payment_due','payment_received','daily_summary','ai_usage_monthly','chatbot_handoff',
    'retail_order_event','retail_customer_order_event','retail_inventory_event') NOT NULL;

CREATE TABLE sx_retail_inventory_alert_states (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  observed_state ENUM('unknown','low','healthy') NOT NULL DEFAULT 'unknown',
  notified_state ENUM('unknown','low','healthy') NOT NULL DEFAULT 'unknown',
  available_quantity DECIMAL(20,6) UNSIGNED DEFAULT NULL,
  low_stock_threshold DECIMAL(20,6) UNSIGNED DEFAULT NULL,
  transition_revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,product_id,location_id),
  KEY ix_retail_inventory_alert_state (tenant_id,observed_state,updated_at),
  CONSTRAINT fk_retail_inventory_alert_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_retail_inventory_alert_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES sx_retail_locations(tenant_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
