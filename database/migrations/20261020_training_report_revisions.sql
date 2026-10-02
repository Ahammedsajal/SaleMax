-- Late corrections create a new immutable revision for the same scheduled period.
ALTER TABLE sx_training_report_runs
  DROP INDEX uq_training_report_run_period,
  DROP INDEX idx_training_report_run_history,
  ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1 AFTER schedule_revision,
  ADD COLUMN revision_reason VARCHAR(500) NULL AFTER snapshot_sha256,
  ADD COLUMN supersedes_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER revision_reason,
  ADD COLUMN request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER supersedes_run_id,
  ADD UNIQUE KEY uq_training_report_run_version (tenant_id,schedule_id,period_start,revision),
  ADD UNIQUE KEY uq_training_report_run_tenant_id (tenant_id,id),
  ADD UNIQUE KEY uq_training_report_revision_request (tenant_id,request_key),
  ADD KEY idx_training_report_run_history (tenant_id,schedule_id,period_start,revision);

ALTER TABLE sx_training_report_runs
  ADD CONSTRAINT fk_training_report_run_supersedes FOREIGN KEY (tenant_id,supersedes_run_id)
    REFERENCES sx_training_report_runs(tenant_id,id),
  ADD CONSTRAINT ck_training_report_run_revision CHECK (
    (revision=1 AND revision_reason IS NULL AND supersedes_run_id IS NULL AND request_key IS NULL)
    OR (revision>1 AND revision_reason IS NOT NULL AND supersedes_run_id IS NOT NULL AND request_key IS NOT NULL)
  );
