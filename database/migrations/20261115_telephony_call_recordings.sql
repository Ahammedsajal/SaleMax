CREATE TABLE sx_telephony_recording_policies (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  notice_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  notice_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  retention_days SMALLINT UNSIGNED NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_sx_telephony_recording_policy_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_telephony_recording_policy_actor FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_sx_telephony_recording_policy_values CHECK (enabled IN (0,1) AND notice_confirmed IN (0,1)
    AND (retention_days IS NULL OR retention_days BETWEEN 1 AND 365)
    AND (enabled=0 OR (notice_confirmed=1 AND retention_days IS NOT NULL)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_telephony_call_recordings (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  call_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recording_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state ENUM('starting','recording','ready','failed','expired') NOT NULL DEFAULT 'starting',
  duration_seconds INT UNSIGNED NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  failure_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,id),
  UNIQUE KEY uq_sx_telephony_call_recording_call (tenant_id,call_id),
  UNIQUE KEY uq_sx_telephony_call_recording_name (recording_name),
  KEY idx_sx_telephony_recordings_expiry (state,expires_at),
  CONSTRAINT fk_sx_telephony_recording_call FOREIGN KEY (tenant_id,call_id) REFERENCES sx_telephony_calls(tenant_id,id),
  CONSTRAINT ck_sx_telephony_recording_duration CHECK (duration_seconds IS NULL OR duration_seconds <= 86400)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
