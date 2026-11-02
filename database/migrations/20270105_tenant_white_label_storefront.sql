-- Add controlled storefront content without re-adding domain-alias columns.
-- A tenant receives this feature only when an owner-approved grant row is enabled.
CREATE TABLE sx_tenant_storefronts (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  draft_json JSON NOT NULL,
  published_json JSON NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  published_revision INT UNSIGNED NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  KEY ix_sx_tenant_storefronts_enabled (enabled,tenant_id),
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
