-- Explicit reviewed mapping only. Never infer platform ownership from email or row order.
CREATE TABLE sx_legacy_admin_identities (
  legacy_admin_id INT NOT NULL PRIMARY KEY,
  legacy_uid VARCHAR(999) NOT NULL,
  legacy_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verified_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verified_at DATETIME(3) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  UNIQUE KEY uq_sx_legacy_admin_uid (legacy_uid_hash),
  UNIQUE KEY uq_sx_legacy_admin_identity (identity_id),
  FOREIGN KEY (identity_id) REFERENCES sx_identities(id),
  FOREIGN KEY (verified_by) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
