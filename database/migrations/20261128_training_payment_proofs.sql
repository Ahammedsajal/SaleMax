-- Extend audited manual collections with common Qatar payment rails and private proof metadata.
ALTER TABLE sx_training_payments
  MODIFY method ENUM('cash','bank_transfer','fawran','pos','cheque','other') NOT NULL,
  ADD COLUMN proof_storage_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN proof_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN proof_mime_type ENUM('image/jpeg','image/png','image/webp') NULL,
  ADD COLUMN proof_bytes INT UNSIGNED NULL,
  ADD COLUMN proof_uploaded_at DATETIME(3) NULL,
  ADD UNIQUE KEY uq_sx_training_payment_proof_storage (tenant_id,proof_storage_key),
  ADD CONSTRAINT ck_sx_training_payment_proof_metadata CHECK (
    (proof_storage_key IS NULL AND proof_sha256 IS NULL AND proof_mime_type IS NULL AND proof_bytes IS NULL AND proof_uploaded_at IS NULL) OR
    (proof_storage_key IS NOT NULL AND proof_sha256 IS NOT NULL AND proof_mime_type IS NOT NULL AND proof_bytes IS NOT NULL AND proof_uploaded_at IS NOT NULL)
  );
ALTER TABLE sx_training_receipts
  MODIFY method_snapshot ENUM('cash','bank_transfer','fawran','pos','cheque','other') NOT NULL;
