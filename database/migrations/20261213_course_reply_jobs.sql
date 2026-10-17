CREATE TABLE IF NOT EXISTS sx_course_reply_jobs (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 owner_hash CHAR(64) NOT NULL,
 chat_id VARCHAR(255) NOT NULL,
 course_id CHAR(36) NOT NULL,
 language_code VARCHAR(2) NOT NULL,
 parts_json LONGTEXT NOT NULL,
 state ENUM('sending','sent','stopped') NOT NULL,
 sent_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 error_code VARCHAR(80) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_course_reply_owner (owner_hash,created_at),
 KEY idx_course_reply_tenant (tenant_id,course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
