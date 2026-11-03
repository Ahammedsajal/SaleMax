ALTER TABLE sx_website_enquiries
  ADD COLUMN industry VARCHAR(40) NULL AFTER lead_id,
  ADD COLUMN consent_version VARCHAR(64) NULL AFTER industry,
  ADD COLUMN consent_text_en TEXT NULL AFTER consent_version,
  ADD COLUMN consent_text_ar TEXT NULL AFTER consent_text_en,
  ADD COLUMN consented_at DATETIME(3) NULL AFTER consent_text_ar,
  ADD COLUMN language VARCHAR(2) NOT NULL DEFAULT 'en' AFTER consented_at;

CREATE TABLE sx_website_enquiry_deliveries (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  submission_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_kind ENUM('sales_owner','submitter') NOT NULL,
  destination_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('queued','sending','accepted','unknown') NOT NULL DEFAULT 'queued',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  provider_message_id VARCHAR(191) NULL,
  error_code VARCHAR(64) NULL,
  accepted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_website_enquiry_delivery (submission_token,recipient_kind),
  KEY ix_website_enquiry_delivery_due (status,available_at,id),
  CONSTRAINT fk_website_enquiry_delivery_request FOREIGN KEY (submission_token)
    REFERENCES sx_website_enquiries(submission_token) ON DELETE CASCADE,
  CONSTRAINT fk_website_enquiry_delivery_tenant FOREIGN KEY (tenant_id)
    REFERENCES sx_tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
