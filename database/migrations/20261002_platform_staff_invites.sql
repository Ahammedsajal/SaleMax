-- Owner-reviewed platform staff invitations. Tokens are stored only as hashes.
CREATE TABLE sx_platform_staff_invites (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_admin_id INT NOT NULL,
  invited_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delegated_permissions JSON NOT NULL,
  status ENUM('pending','accepted','cancelled','expired') NOT NULL DEFAULT 'pending',
  expires_at DATETIME(3) NOT NULL,
  accepted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_staff_invite_identity (identity_id),
  UNIQUE KEY uq_sx_staff_invite_token_hash (token_hash),
  KEY idx_sx_staff_invite_status (status,expires_at),
  KEY idx_sx_staff_invite_actor (invited_by,created_at),
  FOREIGN KEY (identity_id) REFERENCES sx_identities(id),
  FOREIGN KEY (invited_by) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
