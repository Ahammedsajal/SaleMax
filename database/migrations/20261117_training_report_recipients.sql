CREATE TABLE sx_training_report_recipients (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel ENUM('email','whatsapp') NOT NULL,
  destination VARCHAR(254) NOT NULL,
  destination_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','verified','removed') NOT NULL DEFAULT 'pending',
  verified_at DATETIME(3) NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_report_recipient_id (tenant_id,id),
  UNIQUE KEY uq_training_report_recipient (tenant_id,channel,destination_hash),
  KEY idx_training_report_recipient_delivery (tenant_id,channel,status),
  CONSTRAINT fk_training_report_recipient_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_report_recipient_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_training_report_recipient_verified CHECK ((status='verified' AND verified_at IS NOT NULL) OR (status<>'verified' AND verified_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_report_recipient_challenges (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  challenge_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','verified','expired','superseded','failed','unknown','locked') NOT NULL DEFAULT 'pending',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  sent_at DATETIME(3) NULL,
  verified_at DATETIME(3) NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_training_report_recipient_challenge_request (tenant_id,request_key),
  KEY idx_training_report_recipient_challenge_rate (tenant_id,recipient_id,created_at),
  CONSTRAINT fk_training_report_recipient_challenge FOREIGN KEY (tenant_id,recipient_id) REFERENCES sx_training_report_recipients(tenant_id,id),
  CONSTRAINT fk_training_report_recipient_challenge_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_training_report_recipient_challenge_attempts CHECK (attempt_count<=5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sx_training_report_deliveries
  ADD COLUMN recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER channel,
  ADD COLUMN recipient_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' AFTER recipient_id,
  DROP INDEX uq_training_report_delivery_channel,
  ADD UNIQUE KEY uq_training_report_delivery_channel (tenant_id,report_run_id,channel,recipient_key),
  ADD KEY idx_training_report_delivery_recipient (tenant_id,recipient_id),
  ADD CONSTRAINT fk_training_report_delivery_recipient FOREIGN KEY (tenant_id,recipient_id) REFERENCES sx_training_report_recipients(tenant_id,id);
