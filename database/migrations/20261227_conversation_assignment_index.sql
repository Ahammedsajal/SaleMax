ALTER TABLE sx_tenants
  ADD COLUMN conversation_assignment_index_ready_at DATETIME(3) NULL;

CREATE TABLE sx_conversation_assignments (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  chat_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, owner_uid_hash, identity_id, chat_id),
  KEY idx_sx_conversation_assignment_chat (tenant_id, owner_uid_hash, chat_id),
  CONSTRAINT fk_sx_conversation_assignment_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_conversation_assignment_identity FOREIGN KEY (identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
