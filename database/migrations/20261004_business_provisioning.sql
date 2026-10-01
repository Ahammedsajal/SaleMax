-- Idempotent, audited onboarding of existing legacy business users into canonical tenant contracts.
CREATE TABLE sx_business_provisions (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id INT NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  assignment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_limits JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_id),
  UNIQUE KEY uq_sx_business_provision_user (user_id),
  UNIQUE KEY uq_sx_business_provision_tenant (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id),
  FOREIGN KEY (assignment_id) REFERENCES sx_plan_assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
