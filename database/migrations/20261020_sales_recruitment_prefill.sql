ALTER TABLE sx_recruitment_applications
  ADD COLUMN current_work_status ENUM('yes','no') NULL AFTER email,
  ADD COLUMN contact_mobile VARCHAR(40) NULL AFTER mobile,
  ADD COLUMN total_experience_range VARCHAR(12) NULL AFTER experience_years,
  ADD COLUMN sales_experience_years VARCHAR(12) NULL AFTER total_experience_range,
  ADD COLUMN has_computer_and_internet ENUM('yes','no') NULL AFTER sales_experience_years,
  ADD COLUMN comfortable_with_sales_calls ENUM('yes','no') NULL AFTER has_computer_and_internet;

CREATE TABLE sx_recruitment_prefill_tokens (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash BINARY(32) NOT NULL,
  answers JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sx_recruitment_prefill_token (token_hash),
  KEY sx_recruitment_prefill_expiry (tenant_id,expires_at),
  CONSTRAINT sx_recruitment_prefill_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id) ON DELETE CASCADE
);
