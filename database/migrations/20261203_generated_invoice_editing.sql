-- Preserve issued identifiers and retain prior snapshots for reversible document edits/deletions.
CREATE TABLE sx_invoice_generator_document_state (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME(3) NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,document_id),
  CONSTRAINT fk_sx_invoice_edit_state_doc FOREIGN KEY (document_id) REFERENCES sx_invoice_generator_documents(id),
  CONSTRAINT fk_sx_invoice_edit_state_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_invoice_edit_state_actor FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_invoice_generator_document_history (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  prior_revision INT UNSIGNED NOT NULL,
  action ENUM('updated','deleted') NOT NULL,
  prior_snapshot JSON NOT NULL,
  result_snapshot JSON NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_invoice_edit_request (tenant_id,request_key),
  KEY idx_sx_invoice_edit_history (tenant_id,document_id,created_at),
  CONSTRAINT fk_sx_invoice_edit_history_doc FOREIGN KEY (document_id) REFERENCES sx_invoice_generator_documents(id),
  CONSTRAINT fk_sx_invoice_edit_history_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_invoice_edit_history_actor FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
