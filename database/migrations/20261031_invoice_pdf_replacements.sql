-- Keep corrected generated invoices as new immutable documents and link the replaced snapshot.
CREATE TABLE sx_invoice_generator_replacements (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  prior_invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  replacement_invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, prior_invoice_id),
  UNIQUE KEY uq_sx_invoice_gen_replacement (tenant_id, replacement_invoice_id),
  CONSTRAINT fk_sx_invoice_gen_repl_prior FOREIGN KEY (prior_invoice_id) REFERENCES sx_invoice_generator_documents(id),
  CONSTRAINT fk_sx_invoice_gen_repl_new FOREIGN KEY (replacement_invoice_id) REFERENCES sx_invoice_generator_documents(id),
  CONSTRAINT fk_sx_invoice_gen_repl_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_invoice_gen_repl_actor FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_sx_invoice_gen_repl_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 3),
  CONSTRAINT ck_sx_invoice_gen_repl_distinct CHECK (prior_invoice_id <> replacement_invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
