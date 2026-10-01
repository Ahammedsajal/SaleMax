-- Retry ledger for atomic existing-user and canonical business assignments.
-- No ownership inference, customer adoption or historical reassignment.
CREATE TABLE sx_legacy_contract_assignments (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  legacy_user_id INT NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  assignment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_assignment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_contract_assignment (assignment_id),
  UNIQUE KEY uq_sx_contract_legacy_history (legacy_assignment_id),
  KEY idx_sx_contract_user (legacy_user_id,created_at),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id),
  FOREIGN KEY (assignment_id) REFERENCES sx_plan_assignments(id),
  FOREIGN KEY (legacy_assignment_id) REFERENCES sx_legacy_plan_assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
