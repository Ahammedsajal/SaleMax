-- Per-recipient delivery state lets retries skip addresses already accepted
-- by the SMTP provider while retaining an auditable status for every receipt.
CREATE TABLE sx_training_receipt_deliveries (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receipt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  recipient_type ENUM('customer','accountant','admin','combined') NOT NULL,
  status ENUM('ready','sending','sent','dead') NOT NULL DEFAULT 'ready',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  last_error_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_receipt_recipient (tenant_id,receipt_id,recipient_hash),
  KEY idx_training_receipt_delivery_claim (tenant_id,status,available_at,created_at),
  CONSTRAINT fk_training_receipt_delivery_receipt FOREIGN KEY (tenant_id,receipt_id) REFERENCES sx_training_receipts(tenant_id,id),
  CONSTRAINT ck_training_receipt_delivery_lease CHECK ((status='sending' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'sending' AND lease_owner IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT ck_training_receipt_delivery_sent CHECK ((status='sent' AND sent_at IS NOT NULL) OR (status<>'sent' AND sent_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
