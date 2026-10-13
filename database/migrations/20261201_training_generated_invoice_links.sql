-- Link a historical generated PDF to the formal invoice issued from its approved sale.
ALTER TABLE sx_invoice_generator_documents
  ADD UNIQUE KEY uq_sx_invoice_gen_tenant_id (tenant_id,id);

CREATE TABLE sx_training_generated_invoice_links (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generated_document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sale_review_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  linked_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,generated_document_id),
  UNIQUE KEY uq_training_generated_invoice_sale (tenant_id,sale_review_id),
  UNIQUE KEY uq_training_generated_invoice_formal (tenant_id,invoice_id),
  CONSTRAINT fk_training_generated_invoice_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_generated_invoice_document FOREIGN KEY (tenant_id,generated_document_id) REFERENCES sx_invoice_generator_documents(tenant_id,id),
  CONSTRAINT fk_training_generated_invoice_sale FOREIGN KEY (tenant_id,sale_review_id) REFERENCES sx_training_sale_reviews(tenant_id,id),
  CONSTRAINT fk_training_generated_invoice_formal FOREIGN KEY (tenant_id,invoice_id) REFERENCES sx_training_invoices(tenant_id,id),
  CONSTRAINT fk_training_generated_invoice_actor FOREIGN KEY (linked_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
