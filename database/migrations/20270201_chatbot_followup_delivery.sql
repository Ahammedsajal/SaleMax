CREATE TABLE sx_chatbot_followup_settings (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  daily_limit TINYINT UNSIGNED NOT NULL DEFAULT 20,
  min_delay_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 120,
  max_delay_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 600,
  next_send_at DATETIME(3) NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_chatbot_followup_settings_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sx_chatbot_followup_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  step ENUM('day2','day7') NOT NULL,
  due_at DATETIME(3) NOT NULL,
  status ENUM('queued','sending','sent','skipped','uncertain') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until DATETIME(3) NULL,
  provider_message_id VARCHAR(191) NULL,
  last_error_code VARCHAR(64) NULL,
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatbot_followup_delivery (tenant_id,lead_id,step),
  KEY idx_chatbot_followup_delivery_queue (tenant_id,status,due_at,id),
  KEY idx_chatbot_followup_delivery_daily (tenant_id,status,sent_at),
  CONSTRAINT fk_chatbot_followup_delivery_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
