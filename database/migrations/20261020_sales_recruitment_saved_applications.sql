ALTER TABLE sx_recruitment_applications
  MODIFY cv_storage_key VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY cv_file_name VARCHAR(180) NULL,
  MODIFY cv_mime_type VARCHAR(100) NULL,
  MODIFY cv_bytes INT UNSIGNED NULL,
  MODIFY cv_sha256 BINARY(32) NULL;

ALTER TABLE sx_recruitment_prefill_tokens
  ADD COLUMN application_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER tenant_id,
  ADD KEY sx_recruitment_prefill_application (tenant_id,application_id),
  ADD CONSTRAINT sx_recruitment_prefill_application_fk FOREIGN KEY (tenant_id,application_id) REFERENCES sx_recruitment_applications(tenant_id,id) ON DELETE CASCADE;
