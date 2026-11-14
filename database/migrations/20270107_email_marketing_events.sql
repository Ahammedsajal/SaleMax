ALTER TABLE sx_email_campaign_recipients
  ADD UNIQUE KEY uq_sx_email_recipient_id (id);

CREATE TABLE sx_email_provider_events (
  sns_message_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_message_id VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (sns_message_id),
  KEY idx_sx_email_provider_event_recipient (tenant_id,recipient_id,created_at),
  KEY idx_sx_email_provider_event_analytics (tenant_id,created_at,event_type,recipient_id),
  KEY idx_sx_email_provider_event_campaign (tenant_id,campaign_id,event_type,recipient_id),
  KEY idx_sx_email_provider_event_message (provider_message_id,created_at),
  CONSTRAINT fk_sx_email_provider_event_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
