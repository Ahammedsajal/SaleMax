ALTER TABLE sx_business_notification_events
  MODIFY kind ENUM('invoice_issued','payment_due','payment_received','daily_summary','ai_usage_monthly','chatbot_handoff','retail_order_event','retail_customer_order_event') NOT NULL;

ALTER TABLE sx_retail_cash_receipts
  ADD KEY ix_retail_cash_tenant_received (tenant_id,received_at);

ALTER TABLE sx_retail_returns
  ADD KEY ix_retail_return_tenant_created (tenant_id,created_at);

ALTER TABLE sx_business_notification_settings
  ADD COLUMN retail_customer_updates_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER retail_orders_enabled;

CREATE TABLE sx_retail_customer_notification_consents (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel ENUM('whatsapp') NOT NULL,
  purpose ENUM('transactional_order_updates') NOT NULL,
  consent_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('granted','withdrawn') NOT NULL DEFAULT 'granted',
  destination_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_ciphertext VARBINARY(64) NOT NULL,
  token_iv BINARY(12) NOT NULL,
  token_auth_tag BINARY(16) NOT NULL,
  consented_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  withdrawn_at DATETIME(3) DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,order_id),
  KEY ix_retail_notice_consent_status (tenant_id,status,channel,purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_customer_notification_consent_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action ENUM('granted','withdrawn') NOT NULL,
  channel ENUM('whatsapp') NOT NULL,
  purpose ENUM('transactional_order_updates') NOT NULL,
  consent_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  destination_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source ENUM('storefront_checkout','customer_revocation') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_retail_notice_consent_history (tenant_id,order_id,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
