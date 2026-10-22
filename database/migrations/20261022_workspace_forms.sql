-- Shared tenant-owned Forms storage. Training registration remains in its
-- historical sx_training_* tables and is not rewritten by this migration.
CREATE TABLE sx_workspace_forms (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NOT NULL,
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
  UNIQUE KEY uq_workspace_form_tenant_id (tenant_id,id),
  UNIQUE KEY uq_workspace_form_slug (tenant_id,slug),
  UNIQUE KEY uq_workspace_form_published_slug (tenant_id,published_slug),
  KEY idx_workspace_form_status (tenant_id,status,updated_at),
  CONSTRAINT fk_workspace_form_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_workspace_form_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_workspace_form_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_workspace_form_versions (
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
  UNIQUE KEY uq_workspace_form_version (tenant_id,form_id,version),
  UNIQUE KEY uq_workspace_form_version_id (tenant_id,form_id,id),
  CONSTRAINT fk_workspace_form_version_form FOREIGN KEY (tenant_id,form_id) REFERENCES sx_workspace_forms(tenant_id,id),
  CONSTRAINT fk_workspace_form_version_publisher FOREIGN KEY (published_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_workspace_form_submissions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  form_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  form_version INT UNSIGNED NOT NULL,
  capture_mode ENUM('public','staff') NOT NULL,
  captured_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reference_code CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  submission_data JSON NOT NULL,
  attribution_json JSON NULL,
  consent_text_en VARCHAR(1000) NOT NULL,
  consent_text_ar VARCHAR(1000) NOT NULL,
  consented_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workspace_form_submission_idempotency (tenant_id,form_id,idempotency_hash),
  UNIQUE KEY uq_workspace_form_submission_reference (tenant_id,reference_code),
  KEY idx_workspace_form_submission_recent (tenant_id,form_id,created_at),
  KEY idx_workspace_form_submission_lead (tenant_id,lead_id,created_at),
  CONSTRAINT fk_workspace_form_submission_version FOREIGN KEY (tenant_id,form_id,form_version) REFERENCES sx_workspace_form_versions(tenant_id,form_id,version),
  CONSTRAINT fk_workspace_form_submission_actor FOREIGN KEY (captured_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_workspace_form_rate_limits (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  form_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visitor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,form_id,visitor_hash),
  CONSTRAINT fk_workspace_form_rate_form FOREIGN KEY (tenant_id,form_id) REFERENCES sx_workspace_forms(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
