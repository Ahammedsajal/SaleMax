-- Tenant-owned CRM hostname verification and dashboard-only visual identity.
CREATE TABLE sx_tenant_crm_domains (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hostname VARCHAR(253) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','verified','active','disabled') NOT NULL DEFAULT 'pending',
  verification_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verification_expires_at DATETIME(3) NOT NULL,
  ownership_verified_at DATETIME(3) NULL,
  cname_verified_at DATETIME(3) NULL,
  tls_ready_at DATETIME(3) NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  active_tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (CASE WHEN status IN ('pending','verified','active') THEN tenant_id ELSE NULL END) PERSISTENT,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_tenant_crm_domains_one_current (active_tenant_id),
  UNIQUE KEY uq_sx_tenant_crm_domains_hostname (hostname),
  KEY ix_sx_tenant_crm_domains_status (status,hostname),
  CONSTRAINT fk_sx_tenant_crm_domains_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_tenant_crm_domains_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_tenant_crm_branding (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  logo_url VARCHAR(2048) NOT NULL DEFAULT '',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_sx_tenant_crm_branding_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_tenant_crm_branding_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
