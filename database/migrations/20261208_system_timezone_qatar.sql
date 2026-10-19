-- SaleMaX uses Qatar time as its single system timezone. Preserve prior values
-- so the data conversion can be reversed without a full database restore.
CREATE TABLE IF NOT EXISTS sx_timezone_backup_20261208 (
  entity VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  record_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  owner_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  previous_timezone VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  PRIMARY KEY (entity,record_id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO sx_timezone_backup_20261208(entity,record_id,owner_id,previous_timezone)
SELECT CAST('user' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST('' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(timezone AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM user
UNION ALL
SELECT CAST('tenant' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST('' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(timezone AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM sx_tenants
UNION ALL
SELECT CAST('report_schedule' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(tenant_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(timezone AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM sx_training_report_schedules
UNION ALL
SELECT CAST('broadcast' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(broadcast_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(COALESCE(uid,'') AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(timezone AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM broadcast
UNION ALL
SELECT CAST('template_campaign' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(campaign_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(COALESCE(uid,'') AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(timezone AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM beta_campaign;

UPDATE user SET timezone='Asia/Qatar';
UPDATE sx_tenants SET timezone='Asia/Qatar';
UPDATE sx_training_report_schedules SET timezone='Asia/Qatar';
UPDATE broadcast SET timezone='Asia/Qatar';
UPDATE beta_campaign SET timezone='Asia/Qatar';

ALTER TABLE user ALTER timezone SET DEFAULT 'Asia/Qatar';
