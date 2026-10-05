CREATE TABLE sx_platform_asterisk_config (
  id TINYINT UNSIGNED NOT NULL,
  ari_base_url VARCHAR(512) NOT NULL DEFAULT '',
  ari_username VARCHAR(128) NOT NULL DEFAULT '',
  credential_ciphertext VARBINARY(512) NULL,
  credential_iv BINARY(12) NULL,
  credential_auth_tag BINARY(16) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_tested_at DATETIME(3) NULL,
  last_test_status ENUM('success','failed') NULL,
  last_test_version VARCHAR(80) NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  CONSTRAINT ck_sx_platform_asterisk_singleton CHECK (id=1),
  CONSTRAINT ck_sx_platform_asterisk_credentials CHECK (
    (credential_ciphertext IS NULL AND credential_iv IS NULL AND credential_auth_tag IS NULL)
    OR (credential_ciphertext IS NOT NULL AND credential_iv IS NOT NULL AND credential_auth_tag IS NOT NULL)
  ),
  FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_platform_asterisk_config(id) VALUES (1);
