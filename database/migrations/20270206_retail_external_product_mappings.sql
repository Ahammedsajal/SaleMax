CREATE TABLE sx_retail_external_product_mappings (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_variant_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  mapping_status ENUM('mapped','ignored') CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_retail_external_mapping_source (tenant_id,connection_id,external_product_id,external_variant_id),
  UNIQUE KEY uq_retail_external_mapping_target (tenant_id,connection_id,target_product_id),
  KEY ix_retail_external_mapping_status (tenant_id,connection_id,mapping_status,updated_at),
  CONSTRAINT fk_retail_external_mapping_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_external_mapping_source_product FOREIGN KEY (tenant_id,connection_id,external_product_id)
    REFERENCES sx_retail_external_products(tenant_id,connection_id,external_product_id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_external_mapping_product FOREIGN KEY (tenant_id,target_product_id)
    REFERENCES sx_product_catalog(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_external_mapping_creator FOREIGN KEY (created_by_identity_id)
    REFERENCES sx_identities(id),
  CONSTRAINT fk_retail_external_mapping_updater FOREIGN KEY (updated_by_identity_id)
    REFERENCES sx_identities(id),
  CONSTRAINT ck_retail_external_mapping_target CHECK (
    (mapping_status='mapped' AND target_product_id IS NOT NULL) OR
    (mapping_status='ignored' AND target_product_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
