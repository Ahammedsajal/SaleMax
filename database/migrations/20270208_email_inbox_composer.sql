ALTER TABLE sx_email_threads
  DROP FOREIGN KEY fk_sx_email_thread_campaign,
  DROP FOREIGN KEY fk_sx_email_thread_recipient;

ALTER TABLE sx_email_threads
  MODIFY campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY contact_id BIGINT UNSIGNED NULL,
  ADD COLUMN sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER contact_id,
  ADD KEY idx_sx_email_thread_sender (tenant_id,sender_id),
  ADD CONSTRAINT fk_sx_email_thread_campaign FOREIGN KEY (tenant_id,campaign_id) REFERENCES sx_email_campaigns(tenant_id,id),
  ADD CONSTRAINT fk_sx_email_thread_recipient FOREIGN KEY (tenant_id,campaign_id,recipient_id) REFERENCES sx_email_campaign_recipients(tenant_id,campaign_id,id),
  ADD CONSTRAINT fk_sx_email_thread_sender FOREIGN KEY (tenant_id,sender_id) REFERENCES sx_email_senders(tenant_id,id);

ALTER TABLE sx_email_messages
  ADD COLUMN sender_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER from_email,
  ADD COLUMN delivery_status ENUM('draft','queued','sending','sent','failed','uncertain') NULL AFTER inbound_sns_message_id,
  ADD COLUMN draft_revision INT UNSIGNED NOT NULL DEFAULT 0 AFTER delivery_status,
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at,
  ADD UNIQUE KEY uq_sx_email_message_tenant (tenant_id,id);

CREATE TABLE sx_email_message_attachments (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  message_id BIGINT UNSIGNED NOT NULL,
  attachment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,message_id,attachment_id),
  CONSTRAINT fk_sx_email_message_attachment_message FOREIGN KEY (tenant_id,message_id) REFERENCES sx_email_messages(tenant_id,id),
  CONSTRAINT fk_sx_email_message_attachment_file FOREIGN KEY (tenant_id,attachment_id) REFERENCES sx_email_attachments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_email_outbound_queue (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  message_id BIGINT UNSIGNED NOT NULL,
  sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reply_to_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('queued','sending','sent','failed','uncertain') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_expires_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_message_id VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_outbound_message (tenant_id,message_id),
  KEY idx_sx_email_outbound_queue (status,available_at,lease_expires_at,created_at),
  CONSTRAINT fk_sx_email_outbound_message FOREIGN KEY (tenant_id,message_id) REFERENCES sx_email_messages(tenant_id,id),
  CONSTRAINT fk_sx_email_outbound_sender FOREIGN KEY (tenant_id,sender_id) REFERENCES sx_email_senders(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
