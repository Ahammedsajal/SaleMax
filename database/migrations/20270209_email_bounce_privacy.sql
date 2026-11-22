ALTER TABLE sx_email_campaign_recipients
  ADD COLUMN email_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER normalized_email,
  ADD KEY idx_sx_email_recipient_fingerprint (tenant_id,email_fingerprint);

ALTER TABLE sx_email_messages
  ADD COLUMN last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER delivery_status;

CREATE TABLE sx_email_bounce_suppressions (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bounce_type ENUM('Permanent','Undetermined') NOT NULL,
  source VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,email_fingerprint),
  CONSTRAINT fk_sx_email_bounce_suppression_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
