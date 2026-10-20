CREATE TABLE sx_tenant_customization_revisions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_version INT UNSIGNED NOT NULL,
  schema_version INT UNSIGNED NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  kind ENUM('draft','published') NOT NULL,
  document JSON NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_customization_tenant_revision (tenant_id,id),
  UNIQUE KEY uq_sx_customization_sequence (tenant_id,revision),
  KEY idx_sx_customization_history (tenant_id,created_at,id),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_tenant_customization_heads (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  draft_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (tenant_id,active_id) REFERENCES sx_tenant_customization_revisions(tenant_id,id),
  FOREIGN KEY (tenant_id,draft_id) REFERENCES sx_tenant_customization_revisions(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
