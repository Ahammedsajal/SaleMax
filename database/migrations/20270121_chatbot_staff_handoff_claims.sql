-- Durable staff claims for bot handoffs; the first eligible staff YES wins.
ALTER TABLE sx_business_notification_events
  MODIFY COLUMN kind ENUM('invoice_issued','payment_due','payment_received','daily_summary','ai_usage_monthly','chatbot_handoff') NOT NULL;

CREATE TABLE sx_chatbot_handoff_claims (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_kind ENUM('whatsapp_qr','whatsapp_meta') NOT NULL,
  channel_ref VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  claim_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('open','claimed') NOT NULL DEFAULT 'open',
  handoff_task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  notification_event_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  claimed_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  claimed_at DATETIME(3) NULL,
  last_customer_ack_at DATETIME(3) NULL,
  last_customer_ack_inbound_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_chatbot_handoff_conversation (tenant_id,channel_kind,channel_ref,conversation_id),
  UNIQUE KEY uq_sx_chatbot_handoff_code (tenant_id,claim_code),
  KEY idx_sx_chatbot_handoff_queue (tenant_id,status,created_at),
  CONSTRAINT fk_sx_chatbot_handoff_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_chatbot_handoff_profile FOREIGN KEY (tenant_id,profile_id) REFERENCES sx_chatbot_profiles(tenant_id,id),
  CONSTRAINT fk_sx_chatbot_handoff_task FOREIGN KEY (tenant_id,handoff_task_id) REFERENCES sx_tasks(tenant_id,id),
  CONSTRAINT fk_sx_chatbot_handoff_claimant FOREIGN KEY (claimed_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
