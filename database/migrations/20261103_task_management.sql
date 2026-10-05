CREATE TABLE sx_tasks (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  task_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'general',
  source_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('open','in_progress','blocked','completed','canceled') NOT NULL DEFAULT 'open',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  created_by_type ENUM('user','agent','identity') NOT NULL,
  created_by_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_training_task_tenant_id (tenant_id,id),
  KEY idx_sx_training_task_queue (tenant_id,deleted_at,status,due_at,updated_at),
  KEY idx_sx_training_task_legacy_scope (uid_hash,deleted_at,status,due_at),
  KEY idx_sx_training_task_lead (uid_hash,lead_id,deleted_at),
  CONSTRAINT fk_sx_training_task_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT ck_sx_training_task_source CHECK ((source_type IS NULL AND source_id IS NULL) OR (source_type IS NOT NULL AND source_id IS NOT NULL)),
  CONSTRAINT ck_sx_training_task_lead CHECK (source_type<>'lead' OR lead_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_task_participants (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_type ENUM('user','agent','identity') NOT NULL,
  actor_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role ENUM('assignee','observer') NOT NULL,
  added_by_type ENUM('user','agent','identity') NOT NULL,
  added_by_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at DATETIME(3) NULL,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_read_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id,task_id,actor_type,actor_id),
  KEY idx_sx_task_participant_inbox (tenant_id,actor_type,actor_id,removed_at,task_id),
  CONSTRAINT fk_sx_task_participant_task FOREIGN KEY (tenant_id,task_id) REFERENCES sx_tasks(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_task_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  actor_type ENUM('user','agent','identity','system') NOT NULL,
  actor_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status VARCHAR(24) NULL,
  details_json JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sx_task_event_revision (tenant_id,task_id,revision),
  KEY idx_sx_task_event_history (tenant_id,task_id,occurred_at,id),
  KEY idx_sx_task_event_page (tenant_id,task_id,id),
  CONSTRAINT fk_sx_task_event_task FOREIGN KEY (tenant_id,task_id) REFERENCES sx_tasks(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_task_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_type ENUM('user','agent','identity') NOT NULL,
  sender_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sx_task_chat (tenant_id,task_id,id),
  CONSTRAINT fk_sx_task_message_task FOREIGN KEY (tenant_id,task_id) REFERENCES sx_tasks(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_task_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_revision BIGINT UNSIGNED NOT NULL,
  recipient_type ENUM('user','agent','identity') NOT NULL,
  recipient_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel ENUM('email','whatsapp') NOT NULL,
  status ENUM('queued','processing','accepted','delivered','failed','suppressed','unknown') NOT NULL DEFAULT 'queued',
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  provider_message_id VARCHAR(191) NULL,
  last_error_code VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_task_notification (tenant_id,task_id,task_revision,recipient_type,recipient_id,channel),
  KEY idx_sx_task_notification_queue (status,available_at,created_at,id),
  KEY idx_sx_task_notification_page (tenant_id,task_id,id),
  CONSTRAINT fk_sx_task_notification_task FOREIGN KEY (tenant_id,task_id) REFERENCES sx_tasks(tenant_id,id),
  CONSTRAINT ck_sx_task_notification_lease CHECK ((status='processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_task_notification_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_id BIGINT UNSIGNED NOT NULL,
  attempt_number SMALLINT UNSIGNED NOT NULL,
  worker_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome ENUM('leased','accepted','retry','failed','suppressed','unknown','lease_expired') NOT NULL,
  error_code VARCHAR(100) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_task_notification_attempt (notification_id,attempt_number),
  KEY idx_sx_task_notification_attempts (tenant_id,notification_id,started_at),
  CONSTRAINT fk_sx_task_notification_attempt FOREIGN KEY (notification_id) REFERENCES sx_task_notifications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_task_notification_preferences (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_type ENUM('user','agent','identity') NOT NULL,
  actor_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  whatsapp_opt_in TINYINT(1) NOT NULL DEFAULT 0,
  whatsapp_opted_in_at DATETIME(3) NULL,
  whatsapp_opted_out_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,actor_type,actor_id),
  CONSTRAINT fk_sx_task_notification_preference_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT ck_sx_task_whatsapp_opt_in CHECK (whatsapp_opt_in IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
