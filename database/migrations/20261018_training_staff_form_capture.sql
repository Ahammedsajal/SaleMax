-- Keep authenticated staff captures attributable without changing existing public submissions.
ALTER TABLE sx_training_form_submissions
  ADD COLUMN capture_mode ENUM('public','staff') NOT NULL DEFAULT 'public' AFTER form_version,
  ADD COLUMN captured_by_type ENUM('user','agent') NULL AFTER capture_mode,
  ADD COLUMN captured_by_id VARCHAR(128) NULL AFTER captured_by_type,
  ADD KEY idx_sx_form_submission_staff_actor (tenant_id,captured_by_type,captured_by_id,created_at);
