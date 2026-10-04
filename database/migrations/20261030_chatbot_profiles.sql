CREATE TABLE sx_chatbot_profiles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_version INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  engine ENUM('guided','hybrid','ai') NOT NULL,
  status ENUM('draft','testing','live','paused') NOT NULL DEFAULT 'draft',
  config JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sx_chatbot_profiles_tenant_id (tenant_id, id),
  UNIQUE KEY sx_chatbot_profiles_tenant_name (tenant_id, name),
  KEY sx_chatbot_profiles_tenant_status (tenant_id, status, updated_at),
  CONSTRAINT sx_chatbot_profiles_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT sx_chatbot_profiles_created_actor_fk FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT sx_chatbot_profiles_updated_actor_fk FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
);

CREATE TABLE sx_chatbot_channel_assignments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  chatbot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_kind ENUM('whatsapp_meta','whatsapp_qr','telegram','web') NOT NULL,
  channel_ref VARCHAR(160) NOT NULL,
  assigned_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sx_chatbot_channel_unique (tenant_id, channel_kind, channel_ref),
  KEY sx_chatbot_channel_bot (tenant_id, chatbot_id),
  CONSTRAINT sx_chatbot_channel_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT sx_chatbot_channel_bot_fk FOREIGN KEY (tenant_id, chatbot_id) REFERENCES sx_chatbot_profiles(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT sx_chatbot_channel_actor_fk FOREIGN KEY (assigned_by_identity_id) REFERENCES sx_identities(id)
);

CREATE TABLE sx_chatbot_conversation_controls (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_kind ENUM('whatsapp_meta','whatsapp_qr') NOT NULL,
  channel_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id VARCHAR(999) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mode ENUM('inherit','paused') NOT NULL DEFAULT 'inherit',
  pause_until DATETIME(3) NULL,
  reason VARCHAR(240) NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_kind ENUM('identity','system') NOT NULL DEFAULT 'identity',
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sx_chatbot_conversation_control_key (tenant_id, channel_kind, channel_ref, conversation_id),
  KEY sx_chatbot_conversation_control_effective (tenant_id, channel_kind, channel_ref, mode, pause_until),
  CONSTRAINT sx_chatbot_conversation_control_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT sx_chatbot_conversation_control_actor_fk FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT sx_chatbot_conversation_control_actor_check CHECK ((updated_by_kind='identity' AND updated_by_identity_id IS NOT NULL) OR (updated_by_kind='system' AND updated_by_identity_id IS NULL))
);

CREATE TABLE sx_chatbot_provider_configs (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider ENUM('openai','gemini','deepseek') NOT NULL,
  model VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_ciphertext VARBINARY(4096) NOT NULL,
  key_iv BINARY(12) NOT NULL,
  key_auth_tag BINARY(16) NOT NULL,
  daily_token_limit INT UNSIGNED NOT NULL DEFAULT 50000,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT sx_chatbot_provider_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT sx_chatbot_provider_actor_fk FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
);

CREATE TABLE sx_chatbot_usage_daily (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usage_date DATE NOT NULL,
  consumed_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  reserved_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, usage_date),
  CONSTRAINT sx_chatbot_usage_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
);

CREATE TABLE sx_chatbot_turns (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id VARCHAR(999) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inbound_message_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('processing','sent','handed_off','failed') NOT NULL DEFAULT 'processing',
  result_class VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 1,
  lease_until DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sx_chatbot_turn_idempotency (tenant_id, inbound_message_id),
  KEY sx_chatbot_turn_conversation (tenant_id, conversation_id, created_at),
  CONSTRAINT sx_chatbot_turn_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT sx_chatbot_turn_profile_fk FOREIGN KEY (tenant_id, profile_id) REFERENCES sx_chatbot_profiles(tenant_id, id) ON DELETE CASCADE
);
