ALTER TABLE sx_user_optional_features
  ADD COLUMN email_marketing TINYINT(1) NOT NULL DEFAULT 0 AFTER whatsapp_warmer;

ALTER TABLE sx_platform_email_provider_settings
  ADD COLUMN configuration_set_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER region,
  ADD COLUMN sns_topic_arn VARCHAR(256) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER configuration_set_name;
