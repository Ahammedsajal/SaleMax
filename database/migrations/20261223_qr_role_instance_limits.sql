CREATE TABLE sx_qr_role_limits (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_key ENUM('owner','accountant','manager','team_leader','agent') NOT NULL,
  max_instances SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, role_key),
  CONSTRAINT fk_sx_qr_role_limit_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_qr_role_limit_actor FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_sx_qr_role_limit_max CHECK (max_instances <= 50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
