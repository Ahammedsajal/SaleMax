CREATE TABLE sx_sales_commission_payout_batches (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payout_reference VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  total_amount_minor BIGINT UNSIGNED NOT NULL,
  commission_count SMALLINT UNSIGNED NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_sales_payout_batches_tenant_id (tenant_id,id),
  UNIQUE KEY uq_sx_sales_payout_batches_reference (tenant_id,payout_reference),
  KEY idx_sx_sales_payout_batches_created (tenant_id,created_at,id),
  CONSTRAINT fk_sx_sales_payout_batches_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_sales_payout_batches_actor FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT chk_sx_sales_payout_batches_positive CHECK (total_amount_minor>0 AND commission_count>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sx_sales_commissions
  ADD COLUMN payout_batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER payout_reference,
  ADD KEY idx_sx_sales_commission_batch (tenant_id,payout_batch_id),
  ADD CONSTRAINT fk_sx_sales_commission_batch FOREIGN KEY (tenant_id,payout_batch_id)
    REFERENCES sx_sales_commission_payout_batches(tenant_id,id);
