CREATE TABLE sx_login_rate (
  bucket_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  attempts INT UNSIGNED NOT NULL,
  window_end DATETIME(3) NOT NULL,
  KEY idx_sx_login_rate_expiry (window_end)
) ENGINE=InnoDB;

CREATE TABLE sx_mfa_credentials (
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  secret_encrypted VARBINARY(20) NOT NULL,
  nonce VARBINARY(12) NOT NULL,
  auth_tag VARBINARY(16) NOT NULL,
  enrolled_at DATETIME(3) NULL,
  last_counter BIGINT NOT NULL DEFAULT -1,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  window_end DATETIME(3) NOT NULL,
  FOREIGN KEY (identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB;

CREATE TABLE sx_mfa_recovery (
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  used_at DATETIME(3) NULL,
  PRIMARY KEY (identity_id,code_hash),
  FOREIGN KEY (identity_id) REFERENCES sx_mfa_credentials(identity_id)
) ENGINE=InnoDB;
