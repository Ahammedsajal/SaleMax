ALTER TABLE sx_retail_external_orders
  ADD COLUMN subtotal_amount DECIMAL(20,6) NULL AFTER total_amount,
  ADD COLUMN discount_amount DECIMAL(20,6) NULL AFTER subtotal_amount,
  ADD COLUMN shipping_amount DECIMAL(20,6) NULL AFTER discount_amount,
  ADD COLUMN tax_amount DECIMAL(20,6) NULL AFTER shipping_amount,
  ADD COLUMN fee_amount DECIMAL(20,6) NULL AFTER tax_amount,
  ADD COLUMN refund_amount DECIMAL(20,6) NULL AFTER fee_amount;

ALTER TABLE sx_retail_external_products
  ADD COLUMN sku VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL AFTER product_status,
  ADD KEY ix_retail_external_products_sku (tenant_id,connection_id,sku);

CREATE TABLE sx_retail_external_product_variants (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_variant_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sku VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  variant_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown',
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  price DECIMAL(20,6) NOT NULL,
  variant_ciphertext MEDIUMBLOB NOT NULL,
  variant_iv BINARY(12) NOT NULL,
  variant_auth_tag BINARY(16) NOT NULL,
  source_updated_at DATETIME(3) DEFAULT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_variant_id),
  KEY ix_retail_external_variants_parent (tenant_id,connection_id,external_product_id,variant_status),
  KEY ix_retail_external_variants_sku (tenant_id,connection_id,sku),
  CONSTRAINT fk_retail_external_variants_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
