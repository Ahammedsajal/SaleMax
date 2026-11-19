ALTER TABLE sx_platform_email_provider_settings
  ADD COLUMN inbound_sns_topic_arn VARCHAR(256) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER sns_topic_arn,
  ADD COLUMN inbound_sns_subscription_confirmed_at DATETIME(3) NULL AFTER inbound_sns_topic_arn;

ALTER TABLE sx_email_messages
  ADD COLUMN from_email VARCHAR(254) NULL AFTER direction,
  ADD COLUMN inbound_sns_message_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER provider_message_id,
  ADD UNIQUE KEY uq_sx_email_message_inbound_sns (inbound_sns_message_id);

CREATE TABLE sx_email_inbound_domains (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_domain_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  region VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reply_domain VARCHAR(253) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verification_token VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verification_status ENUM('pending','verified','failed') NOT NULL DEFAULT 'pending',
  mx_verified_at DATETIME(3) NULL,
  receiving_status ENUM('pending','active','failed') NOT NULL DEFAULT 'pending',
  receipt_rule_set_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  receipt_rule_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_inbound_domain_scope (tenant_id,id),
  UNIQUE KEY uq_sx_email_inbound_sender_domain (tenant_id,sender_domain_id),
  UNIQUE KEY uq_sx_email_inbound_region_domain (region,reply_domain),
  KEY idx_sx_email_inbound_status (tenant_id,receiving_status,updated_at),
  CONSTRAINT fk_sx_email_inbound_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_email_inbound_sender_domain FOREIGN KEY (tenant_id,sender_domain_id) REFERENCES sx_email_sender_domains(tenant_id,id),
  CONSTRAINT fk_sx_email_inbound_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
