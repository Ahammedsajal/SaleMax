-- Explicitly record and reconcile manual bank/card dispute outcomes.
ALTER TABLE sx_training_journal_entries
  MODIFY entry_type ENUM('invoice_issued','payment_posted','revenue_recognized','credit_issued','refund_posted','chargeback_posted') NOT NULL;

ALTER TABLE sx_training_payment_allocations
  ADD UNIQUE KEY uq_training_payment_allocation_tenant_id (tenant_id,id);

CREATE TABLE sx_training_payment_disputes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resolution_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolution_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  external_reference VARCHAR(200) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('open','won','lost') NOT NULL DEFAULT 'open',
  reported_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resolved_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolved_at DATETIME(3) NULL,
  resolution_reason VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_training_dispute_tenant_id (tenant_id,id),
  UNIQUE KEY uq_training_dispute_request (tenant_id,request_key),
  UNIQUE KEY uq_training_dispute_resolution (tenant_id,resolution_key),
  KEY idx_training_dispute_queue (tenant_id,status,created_at),
  KEY idx_training_dispute_payment (tenant_id,payment_id,status),
  CONSTRAINT fk_training_dispute_payment FOREIGN KEY (tenant_id,payment_id) REFERENCES sx_training_payments(tenant_id,id),
  CONSTRAINT fk_training_dispute_invoice FOREIGN KEY (tenant_id,invoice_id) REFERENCES sx_training_invoices(tenant_id,id),
  CONSTRAINT fk_training_dispute_reporter FOREIGN KEY (reported_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_training_dispute_resolver FOREIGN KEY (resolved_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_training_dispute_amount CHECK(amount_minor>0),
  CONSTRAINT ck_training_dispute_resolution CHECK((status='open' AND resolved_by_identity_id IS NULL AND resolved_at IS NULL AND resolution_key IS NULL AND resolution_hash IS NULL) OR (status<>'open' AND resolved_by_identity_id IS NOT NULL AND resolved_at IS NOT NULL AND resolution_key IS NOT NULL AND resolution_hash IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_payment_allocation_reversals (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dispute_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  allocation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_training_dispute_allocation (tenant_id,dispute_id,allocation_id),
  KEY idx_training_allocation_reversal_allocation (tenant_id,allocation_id),
  CONSTRAINT fk_training_allocation_reversal_dispute FOREIGN KEY (tenant_id,dispute_id) REFERENCES sx_training_payment_disputes(tenant_id,id),
  CONSTRAINT fk_training_allocation_reversal_allocation FOREIGN KEY (tenant_id,allocation_id) REFERENCES sx_training_payment_allocations(tenant_id,id),
  CONSTRAINT ck_training_allocation_reversal_amount CHECK(amount_minor>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
