CREATE TABLE IF NOT EXISTS pipeline_opening_rules (
  id CHAR(36) NOT NULL PRIMARY KEY,
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  name VARCHAR(120) NOT NULL,
  keywords_json LONGTEXT NOT NULL,
  match_mode VARCHAR(16) NOT NULL DEFAULT 'contains',
  phonebook_id BIGINT UNSIGNED NOT NULL,
  agent_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  position INT NOT NULL DEFAULT 100,
  revision INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_opening_rules_owner (uid_hash,enabled,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pipeline_opening_routing_matches (
  id CHAR(36) NOT NULL PRIMARY KEY,
  uid_hash CHAR(64) NOT NULL,
  identity_key CHAR(64) NOT NULL,
  rule_id CHAR(36) NOT NULL,
  rule_name VARCHAR(120) NOT NULL,
  matched_keyword VARCHAR(120) NOT NULL,
  lead_id CHAR(36) NOT NULL,
  chat_id VARCHAR(999) NOT NULL,
  origin VARCHAR(16) NOT NULL,
  agent_id BIGINT UNSIGNED NOT NULL,
  phonebook_id BIGINT UNSIGNED NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  mobile VARCHAR(64) NOT NULL,
  chat_synced TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_opening_routing_customer (uid_hash,identity_key),
  KEY idx_opening_routing_notifications (uid_hash,agent_id,read_at),
  KEY idx_opening_routing_lead (uid_hash,lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
