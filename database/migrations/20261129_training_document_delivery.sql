-- Idempotency and provider acceptance ledger for user-triggered invoice/receipt delivery.
CREATE TABLE sx_training_document_deliveries (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_type ENUM('invoice','receipt') NOT NULL,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel ENUM('email','whatsapp') NOT NULL,
  recipient_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('sending','accepted','failed','unknown') NOT NULL,
  provider_message_id VARCHAR(191) NULL,
  error_code VARCHAR(64) NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_training_document_delivery_request (tenant_id,request_key),
  KEY ix_sx_training_document_delivery_history (tenant_id,document_type,document_id,created_at),
  CONSTRAINT fk_sx_training_document_delivery_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_training_document_delivery_identity FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
);
