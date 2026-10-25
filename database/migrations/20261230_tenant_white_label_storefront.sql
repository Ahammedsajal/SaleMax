-- Domain aliases and their nullable is_primary marker are owned by
-- 20270102_tenant_crm_domain_aliases.sql. Keep storefront schema changes
-- separate so fresh installs and production use the same domain contract.
ALTER TABLE sx_tenant_crm_branding
  ADD COLUMN primary_color CHAR(7) NOT NULL DEFAULT '#1768d4',
  ADD COLUMN accent_color CHAR(7) NOT NULL DEFAULT '#12c9f4',
  ADD COLUMN tagline VARCHAR(180) NOT NULL DEFAULT '',
  ADD COLUMN favicon_url VARCHAR(2048) NOT NULL DEFAULT '',
  ADD COLUMN public_whatsapp_number VARCHAR(20) NOT NULL DEFAULT '';

CREATE TABLE sx_tenant_storefronts (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  draft_json JSON NOT NULL,
  published_json JSON NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  published_revision INT UNSIGNED NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_sx_tenant_storefronts_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_tenant_storefronts_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_tenant_storefront_revisions (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  content_json JSON NOT NULL,
  publication_type ENUM('publish','rollback') NOT NULL DEFAULT 'publish',
  published_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,revision),
  CONSTRAINT fk_sx_tenant_storefront_revisions_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_tenant_storefront_revisions_publisher FOREIGN KEY (published_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
