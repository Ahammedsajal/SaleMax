ALTER TABLE sx_retail_orders
  ADD COLUMN delivery_state ENUM('unassigned','assigned','in_transit','failed','delivered','returned') DEFAULT NULL,
  ADD COLUMN delivery_proof_required TINYINT(1) NOT NULL DEFAULT 0;

UPDATE sx_retail_orders SET delivery_state=CASE
  WHEN fulfillment<>'delivery' THEN NULL
  WHEN status='returned' THEN 'returned'
  WHEN status IN ('completed','partially_returned') THEN 'delivered'
  WHEN status='cancelled' THEN NULL
  WHEN status='dispatched' THEN 'in_transit'
  WHEN driver_id IS NOT NULL THEN 'assigned'
  ELSE 'unassigned'
END;

CREATE TABLE sx_retail_delivery_proofs (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_ciphertext VARBINARY(32) NOT NULL,
  code_iv BINARY(12) NOT NULL,
  code_auth_tag BINARY(16) NOT NULL,
  verification_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  verified_at DATETIME(3) DEFAULT NULL,
  verified_by_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,order_id),
  KEY ix_retail_delivery_proof_verified (tenant_id,verified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_delivery_attempts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  driver_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_number SMALLINT UNSIGNED NOT NULL,
  result ENUM('assigned','failed','retry_started','proof_rejected','proof_verified') NOT NULL,
  reason ENUM('customer_unavailable','address_not_found','customer_rescheduled','access_blocked','other') DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_delivery_attempt_request (tenant_id,order_id,request_id),
  KEY ix_retail_delivery_attempt_history (tenant_id,order_id,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
