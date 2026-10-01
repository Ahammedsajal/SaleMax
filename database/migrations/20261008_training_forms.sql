-- Tenant-owned training-center enquiry forms with editable drafts and immutable published snapshots.
CREATE TABLE sx_training_forms (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NOT NULL,
  published_slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  draft_schema JSON NOT NULL,
  draft_revision INT UNSIGNED NOT NULL DEFAULT 1,
  published_version INT UNSIGNED NULL,
  published_draft_revision INT UNSIGNED NULL,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_training_form_tenant_id (tenant_id,id),
  UNIQUE KEY uq_sx_training_form_slug (tenant_id,slug),
  UNIQUE KEY uq_sx_training_form_published_slug (tenant_id,published_slug),
  KEY idx_sx_training_form_status (tenant_id,status,updated_at),
  CONSTRAINT fk_sx_training_form_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_training_form_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_sx_training_form_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_form_versions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  form_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT UNSIGNED NOT NULL,
  slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NOT NULL,
  schema_json JSON NOT NULL,
  published_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_training_form_version (tenant_id,form_id,version),
  UNIQUE KEY uq_sx_training_form_version_id (tenant_id,form_id,id),
  CONSTRAINT fk_sx_training_form_version_form FOREIGN KEY (tenant_id,form_id) REFERENCES sx_training_forms(tenant_id,id),
  CONSTRAINT fk_sx_training_form_version_publisher FOREIGN KEY (published_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
