ALTER TABLE sx_platform_email_provider_settings
  DROP COLUMN sns_topic_arn,
  DROP COLUMN configuration_set_name;

ALTER TABLE sx_user_optional_features
  DROP COLUMN email_marketing;
