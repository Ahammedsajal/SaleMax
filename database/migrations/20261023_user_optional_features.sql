-- Optional integrations are opt-in per account, independent of catalogue flags.
CREATE TABLE sx_user_optional_features (
  legacy_user_id INT NOT NULL,
  chat_widget TINYINT(1) NOT NULL DEFAULT 0,
  customer_api TINYINT(1) NOT NULL DEFAULT 0,
  webhooks TINYINT(1) NOT NULL DEFAULT 0,
  whatsapp_warmer TINYINT(1) NOT NULL DEFAULT 0,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (legacy_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
