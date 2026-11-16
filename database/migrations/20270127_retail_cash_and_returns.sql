ALTER TABLE sx_retail_orders
  MODIFY COLUMN status ENUM('placed','ready','dispatched','completed','cancelled','returned','partially_returned') NOT NULL DEFAULT 'placed';

CREATE TABLE sx_retail_cash_receipts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  collector_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recorded_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uq_retail_cash_order (tenant_id, order_id),
  UNIQUE KEY uq_retail_cash_request (tenant_id, request_id),
  KEY ix_retail_cash_unsettled (tenant_id, collector_membership_id, settled_at, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_cash_settlements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  driver_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_minor BIGINT UNSIGNED NOT NULL,
  counted_minor BIGINT UNSIGNED NOT NULL,
  status ENUM('matched','variance') NOT NULL,
  recorded_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_settlement_request (tenant_id, request_id),
  KEY ix_retail_settlement_driver (tenant_id, driver_membership_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_cash_settlement_orders (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (tenant_id, settlement_id, order_id),
  KEY ix_retail_settlement_order (tenant_id, order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_returns (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(200) NOT NULL,
  restocked TINYINT(1) NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_return_request (tenant_id, request_id),
  KEY ix_retail_return_order (tenant_id, order_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_return_lines (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  return_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  PRIMARY KEY (tenant_id, return_id, product_id),
  KEY ix_retail_return_line_order (tenant_id, order_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
