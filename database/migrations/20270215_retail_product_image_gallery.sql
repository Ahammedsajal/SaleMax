-- Ordered, tenant-scoped local image copies for imported store products.
-- Index zero mirrors sx_retail_catalogue_import_media for compatibility.
CREATE TABLE sx_retail_catalogue_import_images (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_index TINYINT UNSIGNED NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_media_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  image_url_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  image_state ENUM('pending','ready','none','failed') NOT NULL DEFAULT 'pending',
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  retry_after DATETIME(3) DEFAULT NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,connection_id,external_product_id,image_index),
  KEY ix_retail_import_images_product (tenant_id,product_id,image_index,image_state),
  KEY ix_retail_import_images_media_id (tenant_id,image_media_id),
  CONSTRAINT fk_retail_import_images_connection FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sx_retail_store_connections (tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_import_images_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog (tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_retail_import_images_file FOREIGN KEY (tenant_id,image_media_id)
    REFERENCES sx_product_media (tenant_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Preserve the current imported cover image while the backfill worker adds
-- remaining source images in provider order.
INSERT INTO sx_retail_catalogue_import_images
  (tenant_id,connection_id,external_product_id,image_index,product_id,image_media_id,image_url_hash,image_state,
   attempt_count,retry_after,last_error_code,updated_at)
SELECT tenant_id,connection_id,external_product_id,0,product_id,image_media_id,image_url_hash,image_state,
  attempt_count,retry_after,last_error_code,updated_at
FROM sx_retail_catalogue_import_media;
