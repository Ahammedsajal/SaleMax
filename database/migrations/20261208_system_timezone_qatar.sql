-- SaleMaX uses Qatar time as its single system timezone. Preserve prior values
-- so the data conversion can be reversed without a full database restore.
CREATE TABLE sx_timezone_backup_20261208 (
  entity VARCHAR(32) NOT NULL,
  record_id VARCHAR(255) NOT NULL,
  owner_id VARCHAR(255) NOT NULL DEFAULT '',
  previous_timezone VARCHAR(100) NULL,
  PRIMARY KEY (entity,record_id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_timezone_backup_20261208(entity,record_id,owner_id,previous_timezone)
SELECT 'user',CAST(id AS CHAR),'',timezone FROM user
UNION ALL
SELECT 'tenant',id,'',timezone FROM sx_tenants
UNION ALL
SELECT 'report_schedule',id,tenant_id,timezone FROM sx_training_report_schedules
UNION ALL
SELECT 'broadcast',broadcast_id,uid,timezone FROM broadcast
UNION ALL
SELECT 'template_campaign',campaign_id,uid,timezone FROM beta_campaign;

UPDATE user SET timezone='Asia/Qatar';
UPDATE sx_tenants SET timezone='Asia/Qatar';
UPDATE sx_training_report_schedules SET timezone='Asia/Qatar';
UPDATE broadcast SET timezone='Asia/Qatar';
UPDATE beta_campaign SET timezone='Asia/Qatar';

ALTER TABLE user ALTER timezone SET DEFAULT 'Asia/Qatar';
