-- Tenant-scoped durable events. This table queues work; it never sends externally.
CREATE TABLE sx_training_outbox_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_json JSON NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('ready','leased','delivered','dead') NOT NULL DEFAULT 'ready',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  last_error_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  delivered_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_outbox_tenant_id (tenant_id,id),
  UNIQUE KEY uq_training_outbox_idempotency (tenant_id,idempotency_key),
  KEY idx_training_outbox_claim (status,available_at,created_at),
  KEY idx_training_outbox_tenant_status (tenant_id,status,created_at),
  CONSTRAINT fk_training_outbox_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT ck_training_outbox_lease CHECK ((status='leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT ck_training_outbox_delivery CHECK ((status='delivered' AND delivered_at IS NOT NULL) OR (status<>'delivered' AND delivered_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_outbox_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_number SMALLINT UNSIGNED NOT NULL,
  worker_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome ENUM('leased','delivered','retry','dead','lease_expired') NOT NULL,
  error_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_outbox_attempt (event_id,attempt_number),
  KEY idx_training_outbox_attempt_tenant (tenant_id,event_id,started_at),
  CONSTRAINT fk_training_outbox_attempt_event FOREIGN KEY (tenant_id,event_id) REFERENCES sx_training_outbox_events(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
