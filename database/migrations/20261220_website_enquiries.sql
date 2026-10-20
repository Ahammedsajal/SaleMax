-- Public website requests reuse the admin contact list and first-party Sales pipeline.
CREATE TABLE sx_website_enquiries (
  submission_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contact_form_id INT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_website_enquiry_lead (tenant_id,lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE sx_website_rate_limits (
  visitor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  window_start BIGINT UNSIGNED NOT NULL,
  requests SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor_hash,window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
