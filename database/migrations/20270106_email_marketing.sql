CREATE TABLE sx_platform_email_provider_settings (
  provider_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  region VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  access_key_ciphertext VARBINARY(256) NOT NULL,
  access_key_iv VARBINARY(12) NOT NULL,
  access_key_tag VARBINARY(16) NOT NULL,
  secret_key_ciphertext VARBINARY(512) NOT NULL,
  secret_key_iv VARBINARY(12) NOT NULL,
  secret_key_tag VARBINARY(16) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (provider_key),
  CONSTRAINT fk_sx_platform_email_provider_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE contact
  ADD COLUMN email VARCHAR(254) NULL AFTER mobile,
  ADD COLUMN email_marketing_consent TINYINT(1) NOT NULL DEFAULT 0 AFTER email,
  ADD COLUMN email_marketing_consent_at DATETIME(3) NULL AFTER email_marketing_consent,
  ADD COLUMN email_marketing_consent_source VARCHAR(64) NULL AFTER email_marketing_consent_at,
  ADD COLUMN email_unsubscribed_at DATETIME(3) NULL AFTER email_marketing_consent_source,
  ADD KEY idx_contact_email_owner (uid(191),email(191));

CREATE TABLE sx_email_sender_domains (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  domain VARCHAR(253) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  region VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verification_status ENUM('pending','verified','failed') NOT NULL DEFAULT 'pending',
  dkim_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  dkim_tokens LONGTEXT NOT NULL,
  signing_hosted_zone VARCHAR(253) NULL,
  last_error_code VARCHAR(64) NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_domain_tenant (tenant_id,id),
  UNIQUE KEY uq_sx_email_domain_region_domain (region,domain),
  KEY idx_sx_email_domain_tenant (tenant_id,updated_at),
  CONSTRAINT fk_sx_email_domain_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_email_domain_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_senders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  domain_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verification_status ENUM('pending','verified','failed') NOT NULL DEFAULT 'pending',
  last_error_code VARCHAR(64) NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_sender_tenant (tenant_id,id),
  UNIQUE KEY uq_sx_email_sender_region (tenant_id,email),
  KEY idx_sx_email_sender_domain (tenant_id,domain_id),
  CONSTRAINT fk_sx_email_sender_domain FOREIGN KEY (tenant_id,domain_id) REFERENCES sx_email_sender_domains(tenant_id,id),
  CONSTRAINT fk_sx_email_sender_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_templates (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(120) NOT NULL,
  subject VARCHAR(998) NOT NULL,
  text_body MEDIUMTEXT NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_template_tenant (tenant_id,id),
  KEY idx_sx_email_template_list (tenant_id,updated_at,id),
  CONSTRAINT fk_sx_email_template_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_email_template_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_sx_email_template_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_attachments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content MEDIUMBLOB NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_attachment_tenant (tenant_id,id),
  KEY idx_sx_email_attachment_expiry (expires_at),
  CONSTRAINT fk_sx_email_attachment_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_email_attachment_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_template_attachments (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attachment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (tenant_id,template_id,attachment_id),
  CONSTRAINT fk_sx_email_template_attachment_template FOREIGN KEY (tenant_id,template_id) REFERENCES sx_email_templates(tenant_id,id),
  CONSTRAINT fk_sx_email_template_attachment_attachment FOREIGN KEY (tenant_id,attachment_id) REFERENCES sx_email_attachments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_campaigns (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(120) NOT NULL,
  subject VARCHAR(998) NOT NULL,
  text_body MEDIUMTEXT NOT NULL,
  phonebook_id BIGINT UNSIGNED NOT NULL,
  audience_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('scheduled','queued','sending','completed','needs_review','failed','cancelled') NOT NULL,
  scheduled_at DATETIME(3) NULL,
  recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
  accepted_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  suppressed_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_campaign_tenant (tenant_id,id),
  KEY idx_sx_email_campaign_list (tenant_id,created_at,id),
  KEY idx_sx_email_campaign_queue (status,scheduled_at,created_at),
  CONSTRAINT fk_sx_email_campaign_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_email_campaign_sender FOREIGN KEY (tenant_id,sender_id) REFERENCES sx_email_senders(tenant_id,id),
  CONSTRAINT fk_sx_email_campaign_template FOREIGN KEY (tenant_id,template_id) REFERENCES sx_email_templates(tenant_id,id),
  CONSTRAINT fk_sx_email_campaign_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_campaign_attachments (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attachment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (tenant_id,campaign_id,attachment_id),
  CONSTRAINT fk_sx_email_campaign_attachment_campaign FOREIGN KEY (tenant_id,campaign_id) REFERENCES sx_email_campaigns(tenant_id,id),
  CONSTRAINT fk_sx_email_campaign_attachment_attachment FOREIGN KEY (tenant_id,attachment_id) REFERENCES sx_email_attachments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_campaign_recipients (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  normalized_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_name VARCHAR(200) NOT NULL DEFAULT '',
  unsubscribe_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','sending','accepted','failed','suppressed','unknown') NOT NULL DEFAULT 'pending',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lease_owner VARCHAR(100) NULL,
  lease_expires_at DATETIME(3) NULL,
  provider_message_id VARCHAR(120) NULL,
  last_error_code VARCHAR(64) NULL,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  accepted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_recipient_scope (tenant_id,campaign_id,id),
  UNIQUE KEY uq_sx_email_recipient_contact (tenant_id,campaign_id,contact_id),
  UNIQUE KEY uq_sx_email_recipient_address (tenant_id,campaign_id,normalized_email),
  KEY idx_sx_email_recipient_queue (status,available_at,lease_expires_at,id),
  CONSTRAINT fk_sx_email_recipient_campaign FOREIGN KEY (tenant_id,campaign_id) REFERENCES sx_email_campaigns(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_suppressions (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  normalized_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason ENUM('unsubscribe','bounce','complaint','manual') NOT NULL,
  source VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,normalized_email),
  CONSTRAINT fk_sx_email_suppression_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_consent_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  normalized_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  consented TINYINT(1) NOT NULL,
  source VARCHAR(64) NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sx_email_consent_contact (tenant_id,contact_id,created_at),
  CONSTRAINT fk_sx_email_consent_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_email_consent_actor FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_threads (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  recipient_name VARCHAR(200) NOT NULL DEFAULT '',
  subject VARCHAR(998) NOT NULL,
  last_message_at DATETIME(3) NOT NULL,
  unread_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_thread_scope (tenant_id,id),
  UNIQUE KEY uq_sx_email_thread_recipient (tenant_id,recipient_id),
  KEY idx_sx_email_thread_list (tenant_id,last_message_at,id),
  CONSTRAINT fk_sx_email_thread_campaign FOREIGN KEY (tenant_id,campaign_id) REFERENCES sx_email_campaigns(tenant_id,id),
  CONSTRAINT fk_sx_email_thread_recipient FOREIGN KEY (tenant_id,campaign_id,recipient_id) REFERENCES sx_email_campaign_recipients(tenant_id,campaign_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  thread_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  direction ENUM('outbound','inbound') NOT NULL,
  subject VARCHAR(998) NOT NULL,
  text_body MEDIUMTEXT NOT NULL,
  provider_message_id VARCHAR(120) NULL,
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sx_email_message_thread (tenant_id,thread_id,id),
  CONSTRAINT fk_sx_email_message_thread FOREIGN KEY (tenant_id,thread_id) REFERENCES sx_email_threads(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
