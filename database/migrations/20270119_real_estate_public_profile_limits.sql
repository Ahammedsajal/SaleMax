CREATE TABLE sx_real_estate_public_profile_rate_limits (
  visitor_hash BINARY(32) NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor_hash),
  KEY ix_re_public_profile_rate_window (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
