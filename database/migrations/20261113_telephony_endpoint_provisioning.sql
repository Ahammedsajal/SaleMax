CREATE TABLE sx_telephony_endpoint_provisioning (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_type ENUM('mobile','browser') NOT NULL,
  extension VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  extension_revision BIGINT UNSIGNED NOT NULL,
  credential_revision BIGINT UNSIGNED NOT NULL,
  asterisk_config_revision BIGINT UNSIGNED NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,membership_id,client_type),
  KEY idx_sx_telephony_endpoint_provisioning_extension (extension),
  CONSTRAINT fk_sx_telephony_endpoint_provisioning_membership FOREIGN KEY (tenant_id,membership_id)
    REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT ck_sx_telephony_endpoint_provisioning_extension CHECK (extension REGEXP '^[0-9]{3,8}$'),
  CONSTRAINT ck_sx_telephony_endpoint_provisioning_revisions CHECK (extension_revision >= 1 AND credential_revision >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
