CREATE TABLE sx_business_owner_invites (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_user_id INT NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invited_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','accepted','expired','cancelled') NOT NULL DEFAULT 'pending',
  expires_at DATETIME(3) NOT NULL,
  accepted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_business_owner_invite_token (token_hash),
  KEY idx_sx_business_owner_invite_status (tenant_id,status,expires_at),
  CONSTRAINT fk_sx_business_owner_invite_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_business_owner_invite_identity FOREIGN KEY (identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_sx_business_owner_invite_actor FOREIGN KEY (invited_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
