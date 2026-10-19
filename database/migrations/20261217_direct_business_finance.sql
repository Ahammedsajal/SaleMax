-- Standalone invoices preserve historical deal links; no approval/accountant dependency.
ALTER TABLE sx_sales_invoices
  MODIFY deal_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY uq_sx_sales_direct_invoice_request (tenant_id,idempotency_key);
ALTER TABLE sx_sales_receipts
  ADD COLUMN receipt_number VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY uq_sx_sales_receipt_number (tenant_id,receipt_number);
CREATE TABLE sx_sales_receipt_sequences (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_year SMALLINT UNSIGNED NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,invoice_year),
  CONSTRAINT fk_sx_sales_receipt_sequence_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
