-- TC20: immutable invoice credits with installment allocation snapshots.
ALTER TABLE sx_training_installments
  MODIFY COLUMN status ENUM('pending','due','partial','paid','overdue','cancelled','credited','settled') NOT NULL DEFAULT 'pending';

CREATE TABLE sx_training_credit_notes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  credit_number VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('pending_approval','posted','rejected') NOT NULL DEFAULT 'pending_approval',
  requested_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reviewed_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME(3) NULL,
  review_reason VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_credit_tenant_id (tenant_id,id),
  UNIQUE KEY uq_training_credit_request (tenant_id,request_key),
  UNIQUE KEY uq_training_credit_number (tenant_id,credit_number),
  KEY idx_training_credit_invoice (tenant_id,invoice_id,status,created_at),
  CONSTRAINT fk_training_credit_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_credit_invoice FOREIGN KEY (tenant_id,invoice_id) REFERENCES sx_training_invoices(tenant_id,id),
  CONSTRAINT fk_training_credit_requester FOREIGN KEY (requested_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_training_credit_reviewer FOREIGN KEY (reviewed_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_training_credit_amount CHECK (amount_minor>0),
  CONSTRAINT ck_training_credit_review CHECK ((status='pending_approval' AND reviewed_by_identity_id IS NULL AND reviewed_at IS NULL) OR (status<>'pending_approval' AND reviewed_by_identity_id IS NOT NULL AND reviewed_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_credit_allocations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  credit_note_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_credit_installment (tenant_id,credit_note_id,installment_id),
  KEY idx_training_credit_allocation_invoice (tenant_id,invoice_id,installment_id),
  CONSTRAINT fk_training_credit_allocation_note FOREIGN KEY (tenant_id,credit_note_id) REFERENCES sx_training_credit_notes(tenant_id,id),
  CONSTRAINT fk_training_credit_allocation_invoice FOREIGN KEY (tenant_id,invoice_id) REFERENCES sx_training_invoices(tenant_id,id),
  CONSTRAINT fk_training_credit_allocation_installment FOREIGN KEY (tenant_id,installment_id) REFERENCES sx_training_installments(tenant_id,id),
  CONSTRAINT ck_training_credit_allocation_amount CHECK (amount_minor>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
