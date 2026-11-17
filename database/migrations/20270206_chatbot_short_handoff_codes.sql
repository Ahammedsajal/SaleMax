-- Preserve exact short codes in storage; old staff alerts remain valid only for their original handoff.
ALTER TABLE sx_chatbot_handoff_claims
  MODIFY COLUMN claim_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

CREATE TABLE sx_chatbot_handoff_code_registry (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  claim_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  claim_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_chatbot_handoff_code_registry_code (tenant_id,claim_code),
  UNIQUE KEY uq_sx_chatbot_handoff_code_registry_revision (tenant_id,claim_id,revision),
  KEY idx_sx_chatbot_handoff_code_registry_claim (tenant_id,claim_id),
  CONSTRAINT fk_sx_chatbot_handoff_code_registry_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_chatbot_handoff_code_registry (id,tenant_id,claim_code,claim_id,revision,issued_at)
SELECT UUID(),tenant_id,TRIM(claim_code),id,revision,created_at FROM sx_chatbot_handoff_claims;
