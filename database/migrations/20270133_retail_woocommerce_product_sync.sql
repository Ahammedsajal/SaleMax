-- Explicit, owner-controlled WooCommerce product publishing.
-- The existing connection key remains read-only; write credentials are separate.
ALTER TABLE sx_retail_store_connections
  ADD COLUMN product_sync_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER last_error_code,
  ADD COLUMN product_write_credentials_ciphertext VARBINARY(4096) DEFAULT NULL AFTER credentials_auth_tag,
  ADD COLUMN product_write_credentials_iv BINARY(12) DEFAULT NULL AFTER product_write_credentials_ciphertext,
  ADD COLUMN product_write_credentials_auth_tag BINARY(16) DEFAULT NULL AFTER product_write_credentials_iv,
  ADD COLUMN product_write_verified_at DATETIME(3) DEFAULT NULL AFTER product_sync_enabled;

CREATE TABLE sx_retail_woo_product_mappings (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  local_product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mapping_status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  publish_name TINYINT(1) NOT NULL DEFAULT 0,
  publish_sku TINYINT(1) NOT NULL DEFAULT 0,
  publish_description TINYINT(1) NOT NULL DEFAULT 0,
  publish_price TINYINT(1) NOT NULL DEFAULT 0,
  publish_stock TINYINT(1) NOT NULL DEFAULT 0,
  stock_location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  baseline_json JSON NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_woo_mapping_tenant_id (tenant_id,id),
  UNIQUE KEY uq_retail_woo_mapping_local (tenant_id,connection_id,local_product_id),
  UNIQUE KEY uq_retail_woo_mapping_external (tenant_id,connection_id,external_product_id),
  KEY ix_retail_woo_mapping_queue (tenant_id,connection_id,mapping_status),
  CONSTRAINT fk_retail_woo_mapping_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_woo_mapping_product FOREIGN KEY (tenant_id,local_product_id)
    REFERENCES sx_product_catalog(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_woo_mapping_location FOREIGN KEY (tenant_id,stock_location_id)
    REFERENCES sx_retail_locations(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_woo_mapping_created_by FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_retail_woo_mapping_updated_by FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_retail_woo_mapping_stock_location CHECK (publish_stock=0 OR stock_location_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_woo_product_sync_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mapping_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  field_name ENUM('name','sku','description','price','stock_quantity') NOT NULL,
  desired_value_json JSON NOT NULL,
  approved_remote_value_json JSON DEFAULT NULL,
  override_approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  override_approved_at DATETIME(3) DEFAULT NULL,
  status ENUM('queued','processing','retry','synced','conflict','failed','paused') NOT NULL DEFAULT 'queued',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  lease_until DATETIME(3) DEFAULT NULL,
  last_error_code VARCHAR(64) DEFAULT NULL,
  last_attempt_at DATETIME(3) DEFAULT NULL,
  synced_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_woo_sync_job_field (tenant_id,mapping_id,field_name),
  KEY ix_retail_woo_sync_job_queue (status,available_at,lease_until,id),
  KEY ix_retail_woo_sync_job_connection (tenant_id,connection_id,updated_at),
  CONSTRAINT fk_retail_woo_sync_job_mapping FOREIGN KEY (tenant_id,mapping_id)
    REFERENCES sx_retail_woo_product_mappings(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_woo_sync_job_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_woo_sync_job_approval FOREIGN KEY (override_approved_by) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_woo_product_sync_conflicts (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mapping_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  field_name ENUM('name','sku','description','price','stock_quantity') NOT NULL,
  local_value_json JSON NOT NULL,
  remote_value_json JSON NOT NULL,
  baseline_value_json JSON DEFAULT NULL,
  status ENUM('active','resolved','paused') NOT NULL DEFAULT 'active',
  resolution VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  resolved_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) DEFAULT NULL,
  PRIMARY KEY (tenant_id,mapping_id,field_name),
  KEY ix_retail_woo_sync_conflict_review (tenant_id,connection_id,status,detected_at),
  CONSTRAINT fk_retail_woo_sync_conflict_mapping FOREIGN KEY (tenant_id,mapping_id)
    REFERENCES sx_retail_woo_product_mappings(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_woo_sync_conflict_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_woo_sync_conflict_resolver FOREIGN KEY (resolved_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
