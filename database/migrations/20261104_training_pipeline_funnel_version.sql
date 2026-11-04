ALTER TABLE pipeline_settings
  ADD COLUMN training_funnel_version TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER interest_keywords;
