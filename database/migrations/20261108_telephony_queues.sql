CREATE TABLE sx_telephony_queues (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  queue_name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  strategy ENUM('ringall','rrmemory','linear') NOT NULL DEFAULT 'ringall',
  ring_timeout_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,id),
  UNIQUE KEY uq_sx_telephony_queue_name (tenant_id,queue_name),
  CONSTRAINT fk_sx_telephony_queue_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_telephony_queue_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_sx_telephony_queue_timeout CHECK (ring_timeout_seconds BETWEEN 5 AND 120),
  CONSTRAINT ck_sx_telephony_queue_name CHECK (queue_name REGEXP '^[a-z][a-z0-9_-]{1,79}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_telephony_queue_members (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  queue_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (tenant_id,queue_id,membership_id),
  UNIQUE KEY uq_sx_telephony_queue_member_position (tenant_id,queue_id,position),
  KEY idx_sx_telephony_queue_membership (tenant_id,membership_id),
  CONSTRAINT fk_sx_telephony_queue_member_queue FOREIGN KEY (tenant_id,queue_id)
    REFERENCES sx_telephony_queues(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_sx_telephony_queue_member_extension FOREIGN KEY (tenant_id,membership_id)
    REFERENCES sx_telephony_extensions(tenant_id,membership_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
