CREATE TABLE sx_chatbot_guided_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_kind ENUM('whatsapp_meta','whatsapp_qr') NOT NULL,
  channel_ref VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id VARCHAR(999) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  conversation_hash BINARY(32) NOT NULL,
  state JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sx_chatbot_guided_session_key (tenant_id,profile_id,channel_kind,channel_ref,conversation_hash),
  KEY sx_chatbot_guided_session_expiry (expires_at),
  CONSTRAINT sx_chatbot_guided_session_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id) ON DELETE CASCADE,
  CONSTRAINT sx_chatbot_guided_session_profile_fk FOREIGN KEY (tenant_id,profile_id) REFERENCES sx_chatbot_profiles(tenant_id,id) ON DELETE CASCADE
);
