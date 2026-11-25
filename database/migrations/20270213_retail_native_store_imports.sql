-- Materialize connected-store imports in the native Retail catalogue and orders
-- while keeping source state distinct from local publication and operations.
ALTER TABLE sx_retail_store_connections
  ADD COLUMN credentials_verified_at DATETIME(3) DEFAULT NULL AFTER credentials_auth_tag;

ALTER TABLE sx_product_catalog
  ADD COLUMN catalogue_kind ENUM('course','product','service') NOT NULL DEFAULT 'service',
  ADD COLUMN parent_product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD KEY ix_sx_product_parent (tenant_id,parent_product_id,status,updated_at),
  ADD CONSTRAINT fk_sx_product_parent FOREIGN KEY (tenant_id,parent_product_id)
    REFERENCES sx_product_catalog (tenant_id,id) ON DELETE RESTRICT;

ALTER TABLE sx_product_offers
  ADD COLUMN source_connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN source_external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN source_external_variant_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD KEY ix_sx_product_offer_source (tenant_id,source_connection_id,source_external_product_id,source_external_variant_id,status),
  ADD CONSTRAINT fk_sx_product_offer_source_connection FOREIGN KEY (tenant_id,source_connection_id)
    REFERENCES sx_retail_store_connections (tenant_id,id) ON DELETE RESTRICT;

CREATE TABLE sx_retail_catalogue_imports (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_variant_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parent_product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  source_sku VARCHAR(100) DEFAULT NULL,
  variant_attributes JSON DEFAULT NULL,
  review_state ENUM('ready','missing_sku','sku_conflict','source_deleted') NOT NULL DEFAULT 'ready',
  source_updated_at DATETIME(3) DEFAULT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_product_id,external_variant_id),
  UNIQUE KEY uq_retail_catalogue_import_product (tenant_id,product_id),
  KEY ix_retail_catalogue_import_parent (tenant_id,connection_id,external_product_id,parent_product_id),
  CONSTRAINT fk_retail_catalogue_import_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections (tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_catalogue_import_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog (tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_catalogue_import_parent FOREIGN KEY (tenant_id,parent_product_id)
    REFERENCES sx_product_catalog (tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sx_retail_external_customers
  ADD COLUMN customer_directory_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN email_lookup_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD KEY ix_retail_external_customer_directory (tenant_id,customer_directory_key,customer_status),
  ADD KEY ix_retail_external_customer_email (tenant_id,email_lookup_hash,customer_status);

ALTER TABLE sx_retail_external_orders
  ADD COLUMN customer_directory_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN email_lookup_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD KEY ix_retail_external_order_directory (tenant_id,customer_directory_key,source_created_at);

ALTER TABLE sx_retail_orders
  ADD COLUMN currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'QAR',
  ADD COLUMN customer_directory_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN external_source_connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN external_source_order_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN source_order_status VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN source_financial_status VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN source_total_amount DECIMAL(20,6) DEFAULT NULL,
  ADD COLUMN source_refund_amount DECIMAL(20,6) DEFAULT NULL,
  ADD UNIQUE KEY uq_retail_order_external_source (tenant_id,external_source_connection_id,external_source_order_id),
  ADD KEY ix_retail_order_customer_directory (tenant_id,customer_directory_key,created_at),
  ADD CONSTRAINT fk_retail_order_source_connection FOREIGN KEY (tenant_id,external_source_connection_id)
    REFERENCES sx_retail_store_connections (tenant_id,id) ON DELETE RESTRICT;

CREATE TABLE sx_retail_customer_search_tokens (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  source_kind ENUM('customer','order','native_order') NOT NULL,
  source_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  customer_directory_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_kind ENUM('name','email','phone') NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (tenant_id,source_kind,source_id,token_kind,token_hash),
  KEY ix_retail_customer_tokens_lookup (tenant_id,token_hash,customer_directory_key),
  KEY ix_retail_customer_tokens_directory (tenant_id,customer_directory_key),
  CONSTRAINT fk_retail_customer_tokens_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections (tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Imported source orders are read-only snapshots and may not have a local stock location.
-- All locally created orders still require a location in the application flow.
ALTER TABLE sx_retail_orders
  MODIFY location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;
