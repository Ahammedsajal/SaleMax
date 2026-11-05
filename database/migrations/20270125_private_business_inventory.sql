CREATE TABLE sx_business_stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_revision VARCHAR(20) NOT NULL,
  previous_quantity INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  reason VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_stock_request (tenant_id, product_id, request_id),
  KEY ix_business_stock_history (tenant_id, product_id, id)
) ENGINE=InnoDB;
