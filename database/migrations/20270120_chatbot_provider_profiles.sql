CREATE TABLE sx_chatbot_provider_profiles (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider ENUM('openai','gemini','deepseek') NOT NULL,
  model VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_ciphertext VARBINARY(4096) NOT NULL,
  key_iv BINARY(12) NOT NULL,
  key_auth_tag BINARY(16) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,provider),
  CONSTRAINT sx_chatbot_provider_profile_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT sx_chatbot_provider_profile_actor_fk FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
);

INSERT IGNORE INTO sx_chatbot_provider_profiles(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,revision,updated_by_identity_id,updated_at)
SELECT tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,revision,updated_by_identity_id,updated_at
FROM sx_chatbot_provider_configs;
