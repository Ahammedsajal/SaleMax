-- Versioned, approved edits to future unpaid installments.
ALTER TABLE sx_training_installments ADD COLUMN schedule_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER status;

CREATE TABLE sx_training_installment_schedule_changes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  base_version INT UNSIGNED NOT NULL,
  resulting_version INT UNSIGNED NULL,
  prior_schedule_json JSON NOT NULL,
  proposed_schedule_json JSON NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('pending_approval','approved','rejected') NOT NULL DEFAULT 'pending_approval',
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reviewed_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME(3) NULL,
  review_reason VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_schedule_change_tenant_id (tenant_id,id),
  UNIQUE KEY uq_training_schedule_change_request (tenant_id,request_key),
  KEY idx_training_schedule_change_review (tenant_id,status,created_at),
  KEY idx_training_schedule_change_invoice (tenant_id,invoice_id,base_version),
  CONSTRAINT fk_training_schedule_change_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_schedule_change_invoice FOREIGN KEY (tenant_id,invoice_id) REFERENCES sx_training_invoices(tenant_id,id),
  CONSTRAINT fk_training_schedule_change_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_training_schedule_change_reviewer FOREIGN KEY (reviewed_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_training_schedule_change_versions CHECK (base_version>0 AND (resulting_version IS NULL OR resulting_version>base_version)),
  CONSTRAINT ck_training_schedule_change_decision CHECK ((status='pending_approval' AND reviewed_by_identity_id IS NULL AND reviewed_at IS NULL) OR (status<>'pending_approval' AND reviewed_by_identity_id IS NOT NULL AND reviewed_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
