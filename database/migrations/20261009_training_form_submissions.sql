-- Public form submissions are idempotent and retain versioned service-contact consent evidence.
CREATE TABLE sx_training_form_submissions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  form_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  form_version INT UNSIGNED NOT NULL,
  idempotency_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reference_code CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  submission_data JSON NOT NULL,
  consent_text_en VARCHAR(1000) NOT NULL,
  consent_text_ar VARCHAR(1000) NOT NULL,
  consented_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_form_submission_idempotency (tenant_id,form_id,idempotency_hash),
  UNIQUE KEY uq_sx_form_submission_reference (tenant_id,reference_code),
  KEY idx_sx_form_submission_recent (tenant_id,form_id,created_at),
  CONSTRAINT fk_sx_form_submission_version FOREIGN KEY (tenant_id,form_id,form_version) REFERENCES sx_training_form_versions(tenant_id,form_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_form_rate_limits (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  form_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visitor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,form_id,visitor_hash),
  CONSTRAINT fk_sx_form_rate_form FOREIGN KEY (tenant_id,form_id) REFERENCES sx_training_forms(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
