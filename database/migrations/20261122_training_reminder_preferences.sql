-- Customer-controlled permission for installment reminders, scoped to one issued invoice.
CREATE TABLE sx_training_reminder_preferences (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_ciphertext VARBINARY(128) NOT NULL,
  token_iv BINARY(12) NOT NULL,
  token_tag BINARY(16) NOT NULL,
  recipient_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','opted_in','opted_out') NOT NULL DEFAULT 'pending',
  consent_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  consented_at DATETIME(3) NULL,
  opted_out_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_reminder_preference_invoice (tenant_id,invoice_id),
  UNIQUE KEY uq_training_reminder_preference_token (token_hash),
  KEY idx_training_reminder_preference_tenant_status (tenant_id,status,updated_at),
  CONSTRAINT fk_training_reminder_preference_invoice FOREIGN KEY (tenant_id,invoice_id) REFERENCES sx_training_invoices(tenant_id,id),
  CONSTRAINT fk_training_reminder_preference_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT ck_training_reminder_preference_consent CHECK ((status='opted_in' AND consented_at IS NOT NULL AND consent_version IS NOT NULL AND opted_out_at IS NULL) OR (status='opted_out' AND consent_version IS NULL AND consented_at IS NULL AND opted_out_at IS NOT NULL) OR (status='pending' AND consent_version IS NULL AND consented_at IS NULL AND opted_out_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_reminder_settings (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  offsets_json JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_training_reminder_settings_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_reminder_settings_actor FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_training_reminder_settings_enabled CHECK (enabled IN (0,1)),
  CONSTRAINT ck_training_reminder_settings_offsets CHECK (JSON_TYPE(offsets_json)='ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sx_training_outbox_events
  MODIFY COLUMN status ENUM('ready','leased','delivered','dead','suppressed') NOT NULL DEFAULT 'ready';

ALTER TABLE sx_training_outbox_attempts
  MODIFY COLUMN outcome ENUM('leased','delivered','retry','dead','lease_expired','suppressed') NOT NULL;
