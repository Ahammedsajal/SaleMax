CREATE TABLE sx_platform_asterisk_runtime (
  id TINYINT UNSIGNED NOT NULL,
  status ENUM('stopped','disabled','starting','connected','reconnecting','error') NOT NULL DEFAULT 'stopped',
  worker_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ari_host VARCHAR(253) CHARACTER SET ascii COLLATE ascii_bin NULL,
  config_revision BIGINT UNSIGNED NULL,
  connected_at DATETIME(3) NULL,
  last_event_at DATETIME(3) NULL,
  last_event_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  events_received BIGINT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT ck_sx_platform_asterisk_runtime_singleton CHECK (id=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_platform_asterisk_runtime(id,status) VALUES(1,'stopped');
