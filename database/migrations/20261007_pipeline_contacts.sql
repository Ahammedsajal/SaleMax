CREATE TABLE IF NOT EXISTS pipeline_contacts (
  id CHAR(36) NOT NULL,
  uid_hash CHAR(64) NOT NULL,
  uid VARCHAR(999) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  normalized_phone VARCHAR(32) NULL,
  normalized_email VARCHAR(254) NULL,
  preferred_language ENUM('en','ar') NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_contact_tenant_id (uid_hash, id),
  KEY idx_pipeline_contact_phone (uid_hash, normalized_phone),
  KEY idx_pipeline_contact_email (uid_hash, normalized_email),
  KEY idx_pipeline_contact_name (uid_hash, display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE pipeline_leads
  ADD COLUMN contact_id CHAR(36) NULL AFTER uid,
  ADD COLUMN learner_name VARCHAR(255) NULL AFTER contact_name,
  ADD KEY idx_pipeline_lead_contact (uid_hash, contact_id, status);

ALTER TABLE pipeline_leads
  ADD CONSTRAINT fk_pipeline_lead_contact
  FOREIGN KEY (uid_hash, contact_id) REFERENCES pipeline_contacts(uid_hash, id);
