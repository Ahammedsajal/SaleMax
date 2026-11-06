CREATE TABLE sx_retail_store (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  about TEXT NOT NULL,
  contact VARCHAR(200) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  delivery_zones JSON DEFAULT NULL,
  delivery_fee INT UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_listings (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  photo_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  category VARCHAR(100) NOT NULL DEFAULT '',
  published TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  buyer_name VARCHAR(120) NOT NULL,
  buyer_phone VARCHAR(30) NOT NULL,
  delivery_address VARCHAR(500) NOT NULL,
  delivery_pin VARCHAR(48) DEFAULT NULL,
  delivery_zone VARCHAR(100) DEFAULT NULL,
  fulfillment ENUM('pickup','delivery') NOT NULL,
  order_lines JSON NOT NULL,
  total_minor BIGINT UNSIGNED NOT NULL,
  delivery_fee INT UNSIGNED NOT NULL,
  status ENUM('placed','ready','dispatched','completed','cancelled','returned') NOT NULL DEFAULT 'placed',
  lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  cash_received_at DATETIME(3) DEFAULT NULL,
  cash_received_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  driver_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_request (tenant_id, request_id),
  KEY ix_retail_queue (tenant_id, status, created_at),
  KEY ix_retail_driver (tenant_id, driver_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_stock_reservations (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  PRIMARY KEY (tenant_id, product_id, order_id),
  KEY ix_retail_reservation_order (tenant_id, order_id)
) ENGINE=InnoDB;
