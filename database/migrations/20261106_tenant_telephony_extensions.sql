CREATE TABLE sx_telephony_extensions (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  extension VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  assigned_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,membership_id),
  UNIQUE KEY uq_sx_telephony_extension_shared_pbx (extension),
  KEY idx_sx_telephony_extension_tenant (tenant_id,extension),
  CONSTRAINT fk_sx_telephony_extension_membership FOREIGN KEY (tenant_id,membership_id)
    REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_sx_telephony_extension_assigner FOREIGN KEY (assigned_by_identity_id)
    REFERENCES sx_identities(id),
  CONSTRAINT ck_sx_telephony_extension_format CHECK (extension IS NULL OR extension REGEXP '^[0-9]{3,8}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
