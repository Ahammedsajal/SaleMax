CREATE TABLE IF NOT EXISTS pipeline_settings (
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  auto_capture_qr TINYINT(1) NOT NULL DEFAULT 1,
  auto_capture_meta TINYINT(1) NOT NULL DEFAULT 1,
  qr_entry_stage VARCHAR(64) NOT NULL DEFAULT 'new',
  meta_entry_stage VARCHAR(64) NOT NULL DEFAULT 'new',
  interested_stage VARCHAR(64) NOT NULL DEFAULT 'interested',
  interest_keywords LONGTEXT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (uid_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  stage_key VARCHAR(64) NOT NULL,
  title VARCHAR(100) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  color VARCHAR(16) NOT NULL DEFAULT '#12a889',
  stage_type ENUM('open','won','lost') NOT NULL DEFAULT 'open',
  probability TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_stage_key (uid_hash, stage_key),
  KEY idx_pipeline_stage_order (uid_hash, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_leads (
  id CHAR(36) NOT NULL,
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  identity_key CHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  contact_name VARCHAR(255) NULL,
  mobile VARCHAR(64) NULL,
  chat_id VARCHAR(999) NULL,
  primary_origin ENUM('qr','meta','manual') NOT NULL DEFAULT 'manual',
  source_type VARCHAR(64) NOT NULL DEFAULT 'manual',
  source_id VARCHAR(191) NULL,
  source_url TEXT NULL,
  source_headline VARCHAR(500) NULL,
  stage_key VARCHAR(64) NOT NULL DEFAULT 'new',
  stage_entered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  owner_agent_id INT NULL,
  status ENUM('open','won','lost') NOT NULL DEFAULT 'open',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  expected_value DECIMAL(14,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'QAR',
  next_follow_up_at DATETIME(3) NULL,
  first_inbound_at DATETIME(3) NULL,
  last_activity_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  close_reason VARCHAR(255) NULL,
  automation_paused TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pipeline_board (uid_hash, status, stage_key, updated_at),
  KEY idx_pipeline_identity (uid_hash, identity_key, status, updated_at),
  KEY idx_pipeline_owner (uid_hash, owner_agent_id, status, last_activity_at),
  KEY idx_pipeline_followup (uid_hash, next_follow_up_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_identity_locks (
  uid_hash CHAR(64) NOT NULL,
  identity_key CHAR(64) NOT NULL,
  current_lead_id CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (uid_hash, identity_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid_hash CHAR(64) NOT NULL,
  lead_id CHAR(36) NOT NULL,
  conversation_key CHAR(64) NOT NULL,
  chat_id VARCHAR(999) NOT NULL,
  origin ENUM('qr','meta') NOT NULL,
  first_inbound_at DATETIME(3) NOT NULL,
  last_inbound_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_conversation (uid_hash, conversation_key),
  KEY idx_pipeline_conversation_lead (uid_hash, lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_attributions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid_hash CHAR(64) NOT NULL,
  lead_id CHAR(36) NOT NULL,
  conversation_key CHAR(64) NOT NULL,
  event_key CHAR(64) NOT NULL,
  provider_message_id VARCHAR(191) NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(191) NULL,
  source_url TEXT NULL,
  headline VARCHAR(500) NULL,
  body VARCHAR(1000) NULL,
  media_type VARCHAR(64) NULL,
  ctwa_clid VARCHAR(255) NULL,
  is_verified_ad TINYINT(1) NOT NULL DEFAULT 0,
  event_at DATETIME(3) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_attribution_event (uid_hash, event_key),
  KEY idx_pipeline_attribution_lead (uid_hash, lead_id, received_at),
  KEY idx_pipeline_verified_ads (uid_hash, is_verified_ad, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  event_key CHAR(64) NOT NULL,
  origin ENUM('qr','meta') NOT NULL,
  lead_id CHAR(36) NULL,
  conversation_key CHAR(64) NOT NULL,
  chat_id VARCHAR(999) NOT NULL,
  provider_message_id VARCHAR(191) NULL,
  sender_mobile VARCHAR(64) NULL,
  sender_name VARCHAR(255) NULL,
  referral_source_type VARCHAR(64) NULL,
  referral_source_id VARCHAR(191) NULL,
  referral_source_url TEXT NULL,
  referral_headline VARCHAR(500) NULL,
  referral_body VARCHAR(1000) NULL,
  referral_media_type VARCHAR(64) NULL,
  referral_ctwa_clid VARCHAR(255) NULL,
  verified_ad TINYINT(1) NOT NULL DEFAULT 0,
  event_at DATETIME(3) NULL,
  status ENUM('pending','processed','ignored','dead') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  retry_after DATETIME(3) NULL,
  last_error_code VARCHAR(64) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_event (uid_hash, event_key),
  KEY idx_pipeline_events_lead (uid_hash, lead_id, received_at),
  KEY idx_pipeline_event_retry (status, retry_after, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid_hash CHAR(64) NOT NULL,
  lead_id CHAR(36) NOT NULL,
  actor_type ENUM('user','agent','system') NOT NULL DEFAULT 'system',
  actor_id VARCHAR(191) NULL,
  activity_type VARCHAR(64) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  details LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pipeline_activity_lead (uid_hash, lead_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_phonebook_map (
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  book_kind ENUM('whatsapp','meta_ads') NOT NULL,
  phonebook_id INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (uid_hash, book_kind),
  UNIQUE KEY uq_pipeline_phonebook_id (uid_hash, phonebook_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_phonebook_memberships (
  uid_hash CHAR(64) NOT NULL,
  phonebook_id INT NOT NULL,
  identity_key CHAR(64) NOT NULL,
  contact_id INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (uid_hash, phonebook_id, identity_key),
  KEY idx_pipeline_membership_contact (uid_hash, contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
