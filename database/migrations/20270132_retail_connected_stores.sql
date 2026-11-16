CREATE TABLE sx_retail_store_connections (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider ENUM('shopify','woocommerce') NOT NULL,
  store_domain VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  default_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'QAR',
  status ENUM('pending','active','paused','error','revoked') NOT NULL DEFAULT 'pending',
  scopes JSON NOT NULL,
  credentials_ciphertext VARBINARY(4096) DEFAULT NULL,
  credentials_iv BINARY(12) DEFAULT NULL,
  credentials_auth_tag BINARY(16) DEFAULT NULL,
  webhook_secret_ciphertext VARBINARY(256) DEFAULT NULL,
  webhook_secret_iv BINARY(12) DEFAULT NULL,
  webhook_secret_auth_tag BINARY(16) DEFAULT NULL,
  sync_cursor MEDIUMTEXT DEFAULT NULL,
  sync_lock_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  sync_lock_until DATETIME(3) DEFAULT NULL,
  last_sync_at DATETIME(3) DEFAULT NULL,
  last_error_code VARCHAR(64) DEFAULT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_connection_tenant_id (tenant_id,id),
  UNIQUE KEY uq_retail_connection_store (provider,store_domain),
  KEY ix_retail_connections_tenant_status (tenant_id,status,provider),
  CONSTRAINT fk_retail_connections_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_store_oauth_states (
  state_hash BINARY(32) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider ENUM('shopify') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_retail_oauth_expiry (expires_at,consumed_at),
  CONSTRAINT fk_retail_oauth_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_external_customers (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_customer_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  customer_status ENUM('active','deleted','redacted') NOT NULL DEFAULT 'active',
  customer_ciphertext MEDIUMBLOB DEFAULT NULL,
  customer_iv BINARY(12) DEFAULT NULL,
  customer_auth_tag BINARY(16) DEFAULT NULL,
  source_updated_at DATETIME(3) DEFAULT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_customer_id),
  KEY ix_retail_external_customers_list (tenant_id,connection_id,customer_status,source_updated_at),
  CONSTRAINT fk_retail_external_customers_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_external_products (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  price DECIMAL(20,6) NOT NULL,
  product_ciphertext MEDIUMBLOB NOT NULL,
  product_iv BINARY(12) NOT NULL,
  product_auth_tag BINARY(16) NOT NULL,
  source_updated_at DATETIME(3) DEFAULT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_product_id),
  KEY ix_retail_external_products_list (tenant_id,connection_id,product_status,source_updated_at),
  CONSTRAINT fk_retail_external_products_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_store_privacy_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_request_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_kind ENUM('customer_data','customer_redact') NOT NULL,
  request_payload_ciphertext MEDIUMBLOB DEFAULT NULL,
  request_payload_iv BINARY(12) DEFAULT NULL,
  request_payload_auth_tag BINARY(16) DEFAULT NULL,
  status ENUM('received','prepared','completed','cancelled') NOT NULL DEFAULT 'received',
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  prepared_at DATETIME(3) DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uq_retail_privacy_request_provider (connection_id,provider_request_id),
  KEY ix_retail_privacy_request_queue (tenant_id,connection_id,status,received_at),
  CONSTRAINT fk_retail_privacy_request_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_external_transactions (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_order_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_transaction_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transaction_kind VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transaction_status VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount DECIMAL(20,6) NOT NULL,
  gateway VARCHAR(100) DEFAULT NULL,
  processed_at DATETIME(3) DEFAULT NULL,
  transaction_ciphertext MEDIUMBLOB NOT NULL,
  transaction_iv BINARY(12) NOT NULL,
  transaction_auth_tag BINARY(16) NOT NULL,
  PRIMARY KEY (tenant_id,connection_id,external_order_id,external_transaction_id),
  KEY ix_retail_external_transactions_order (tenant_id,connection_id,external_order_id,processed_at),
  CONSTRAINT fk_retail_external_transactions_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_external_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  topic VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_ciphertext MEDIUMBLOB DEFAULT NULL,
  payload_iv BINARY(12) DEFAULT NULL,
  payload_auth_tag BINARY(16) DEFAULT NULL,
  status ENUM('received','processed','failed') NOT NULL DEFAULT 'received',
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(64) DEFAULT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uq_retail_external_event (connection_id,provider_event_id),
  KEY ix_retail_external_events_queue (status,received_at,id),
  KEY ix_retail_external_events_tenant (tenant_id,connection_id,received_at),
  CONSTRAINT fk_retail_external_events_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_external_orders (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_order_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_number VARCHAR(80) DEFAULT NULL,
  order_status VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  financial_status VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  total_amount DECIMAL(20,6) NOT NULL,
  customer_external_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  contact_consent ENUM('granted','denied','unknown') NOT NULL DEFAULT 'unknown',
  consent_at DATETIME(3) DEFAULT NULL,
  customer_ciphertext MEDIUMBLOB DEFAULT NULL,
  customer_iv BINARY(12) DEFAULT NULL,
  customer_auth_tag BINARY(16) DEFAULT NULL,
  order_ciphertext MEDIUMBLOB NOT NULL,
  order_iv BINARY(12) NOT NULL,
  order_auth_tag BINARY(16) NOT NULL,
  source_updated_at DATETIME(3) DEFAULT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_order_id),
  KEY ix_retail_external_orders_list (tenant_id,connection_id,source_updated_at,external_order_id),
  KEY ix_retail_external_orders_status (tenant_id,connection_id,order_status,financial_status),
  CONSTRAINT fk_retail_external_orders_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_external_checkouts (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_checkout_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkout_status ENUM('started','abandoned','recovered','expired','payment_pending','unknown') NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  total_amount DECIMAL(20,6) NOT NULL,
  customer_external_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  contact_consent ENUM('granted','denied','unknown') NOT NULL DEFAULT 'unknown',
  consent_at DATETIME(3) DEFAULT NULL,
  customer_ciphertext MEDIUMBLOB DEFAULT NULL,
  customer_iv BINARY(12) DEFAULT NULL,
  customer_auth_tag BINARY(16) DEFAULT NULL,
  recovery_ciphertext VARBINARY(4096) DEFAULT NULL,
  recovery_iv BINARY(12) DEFAULT NULL,
  recovery_auth_tag BINARY(16) DEFAULT NULL,
  checkout_ciphertext MEDIUMBLOB NOT NULL,
  checkout_iv BINARY(12) NOT NULL,
  checkout_auth_tag BINARY(16) NOT NULL,
  source_updated_at DATETIME(3) DEFAULT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_checkout_id),
  KEY ix_retail_external_checkouts_queue (tenant_id,connection_id,checkout_status,source_updated_at),
  CONSTRAINT fk_retail_external_checkouts_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
