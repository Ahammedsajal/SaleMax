CREATE TABLE IF NOT EXISTS pipeline_meta_ads_messages (
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  message_hash CHAR(64) NOT NULL,
  message_text TEXT NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (uid_hash, message_hash),
  KEY idx_pipeline_meta_ads_messages_order (uid_hash, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
