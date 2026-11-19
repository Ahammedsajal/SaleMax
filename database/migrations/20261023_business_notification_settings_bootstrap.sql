-- This table is needed by the next migration before the later WhatsApp notification migration.
-- The later create is idempotent so clean installs and already-provisioned tenants both work.
CREATE TABLE IF NOT EXISTS sx_business_notification_settings (
 tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 enabled TINYINT(1) NOT NULL DEFAULT 1,
 daily_enabled TINYINT(1) NOT NULL DEFAULT 1,
 daily_time TIME NOT NULL DEFAULT '18:00:00',
 qr_instance_id BIGINT UNSIGNED NULL,
 activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_business_notification_settings FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
