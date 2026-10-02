-- Durable schedule execution records. Generated reports are data snapshots;
-- delivery is tracked separately and remains provider-gated.
ALTER TABLE sx_training_report_schedules
  ADD UNIQUE KEY uq_training_report_schedule_tenant_id (tenant_id,id);

CREATE TABLE sx_training_report_runs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schedule_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schedule_revision INT UNSIGNED NOT NULL,
  period ENUM('daily','weekly','monthly') NOT NULL,
  period_start DATETIME(3) NOT NULL,
  period_end DATETIME(3) NOT NULL,
  cutoff_at DATETIME(3) NOT NULL,
  timezone VARCHAR(64) NOT NULL,
  metric_definition_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('queued','processing','retry','generated','dead','suppressed') NOT NULL DEFAULT 'queued',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  snapshot_json JSON NULL,
  snapshot_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_error_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  generated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_report_run_period (tenant_id,schedule_id,period_start),
  KEY idx_training_report_run_ready (status,available_at,created_at),
  KEY idx_training_report_run_history (tenant_id,schedule_id,period_start),
  CONSTRAINT fk_training_report_run_schedule FOREIGN KEY (tenant_id,schedule_id) REFERENCES sx_training_report_schedules(tenant_id,id),
  CONSTRAINT ck_training_report_run_window CHECK (period_end > period_start AND cutoff_at >= period_start),
  CONSTRAINT ck_training_report_run_lease CHECK ((status='processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT ck_training_report_run_snapshot CHECK ((status='generated' AND snapshot_json IS NOT NULL AND snapshot_sha256 IS NOT NULL AND generated_at IS NOT NULL) OR (status<>'generated' AND generated_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
