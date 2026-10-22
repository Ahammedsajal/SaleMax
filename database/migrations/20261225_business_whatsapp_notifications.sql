-- Transactional business alerts; historical invoices are not backfilled.
CREATE TABLE sx_business_notification_settings (
 tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 enabled TINYINT(1) NOT NULL DEFAULT 1,
 daily_enabled TINYINT(1) NOT NULL DEFAULT 1,
 daily_time TIME NOT NULL DEFAULT '18:00:00',
 qr_instance_id BIGINT UNSIGNED NULL,
 activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_business_notification_settings FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE sx_business_notification_events (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind ENUM('invoice_issued','payment_due','payment_received','daily_summary') NOT NULL,
 source_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_json JSON NULL,
 status ENUM('queued','prepared','failed') NOT NULL DEFAULT 'queued',
 last_error_code VARCHAR(100) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_business_event (tenant_id,event_key),
 UNIQUE KEY uq_business_event_tenant_id (tenant_id,id),
 KEY idx_business_event_queue (status,created_at),
 CONSTRAINT fk_business_event_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE sx_business_notification_deliveries (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 recipient_kind ENUM('identity','customer','report_recipient') NOT NULL,
 recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 destination_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 part ENUM('text','pdf') NOT NULL,
 status ENUM('queued','sending','accepted','blocked','failed','suppressed','unknown') NOT NULL DEFAULT 'queued',
 attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 lease_expires_at DATETIME(3) NULL,
 provider_message_id VARCHAR(191) NULL,
 error_code VARCHAR(100) NULL,
 accepted_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_business_delivery (event_id,destination_hash,part),
 KEY idx_business_delivery_queue (status,available_at,id),
 KEY idx_business_delivery_tenant (tenant_id,event_id),
 CONSTRAINT fk_business_delivery_event FOREIGN KEY (tenant_id,event_id) REFERENCES sx_business_notification_events(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
