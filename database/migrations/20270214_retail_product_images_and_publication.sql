-- Publish imported items in the native 7Network catalogue and track local
-- product image copies without changing public Retail store listing state.
CREATE TABLE sx_retail_catalogue_import_media (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_media_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  image_url_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  image_state ENUM('pending','ready','none','failed') NOT NULL DEFAULT 'pending',
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  retry_after DATETIME(3) DEFAULT NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_product_id),
  KEY ix_retail_import_media_product (tenant_id,product_id,image_state),
  KEY ix_retail_import_media_id (tenant_id,image_media_id),
  CONSTRAINT fk_retail_import_media_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections (tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_import_media_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog (tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_import_media_file FOREIGN KEY (tenant_id,image_media_id)
    REFERENCES sx_product_media (tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE sx_product_catalog p
JOIN sx_retail_catalogue_imports i ON i.tenant_id=p.tenant_id AND i.product_id=p.id
SET p.status='active',p.revision=p.revision+1,p.updated_at=UTC_TIMESTAMP(3)
WHERE p.catalogue_kind='product' AND p.status='draft' AND p.deleted_at IS NULL AND i.review_state<>'source_deleted';
