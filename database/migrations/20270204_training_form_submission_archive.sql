-- Retain submitted application and consent history while allowing tenant owners
-- to hide an application from the active review list and restore it later.
ALTER TABLE sx_training_form_submissions
  ADD COLUMN archived_at DATETIME(3) NULL AFTER consented_at,
  ADD COLUMN archived_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER archived_at,
  ADD KEY ix_sx_form_submission_archive (tenant_id, archived_at, created_at),
  ADD CONSTRAINT fk_sx_form_submission_archiver
    FOREIGN KEY (archived_by_identity_id) REFERENCES sx_identities(id);
