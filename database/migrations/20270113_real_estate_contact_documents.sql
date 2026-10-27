-- Private owner, manager and partner company documents (for example, trade licences).
CREATE TABLE sx_real_estate_contact_documents (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contact_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(240) NOT NULL,
  file_size_bytes BIGINT UNSIGNED NOT NULL,
  sha256_hex CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY(id),
  UNIQUE KEY uq_sx_re_contact_document_tenant_id(tenant_id,id),
  KEY idx_sx_re_contact_document(tenant_id,contact_id,deleted_at,created_at),
  CONSTRAINT fk_sx_re_contact_document_contact FOREIGN KEY(tenant_id,contact_id) REFERENCES sx_real_estate_contacts(tenant_id,id),
  CONSTRAINT fk_sx_re_contact_document_creator FOREIGN KEY(tenant_id,created_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT ck_sx_re_contact_document_size CHECK(file_size_bytes BETWEEN 8 AND 104857600)
);
