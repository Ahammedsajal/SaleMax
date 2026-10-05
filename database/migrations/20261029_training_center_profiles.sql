-- Public-facing training-center profile, kept separate from legal/finance identity.
ALTER TABLE sx_training_courses
  MODIFY duration_value SMALLINT UNSIGNED NULL,
  MODIFY duration_unit ENUM('hours','days','weeks','months') NULL,
  MODIFY delivery_mode ENUM('in_person','online','hybrid') NULL,
  ADD COLUMN source_categories JSON NULL AFTER prerequisites_ar;

CREATE TABLE sx_training_center_profiles (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name_en VARCHAR(200) NOT NULL DEFAULT '',
  display_name_ar VARCHAR(200) NOT NULL DEFAULT '',
  logo_url VARCHAR(2048) NOT NULL DEFAULT '',
  website_url VARCHAR(2048) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  phone VARCHAR(80) NOT NULL DEFAULT '',
  address_en VARCHAR(1000) NOT NULL DEFAULT '',
  address_ar VARCHAR(1000) NOT NULL DEFAULT '',
  google_maps_url VARCHAR(2048) NOT NULL DEFAULT '',
  opening_hours VARCHAR(500) NOT NULL DEFAULT '',
  about_en TEXT NOT NULL,
  about_ar TEXT NOT NULL,
  social_links JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_sx_training_profile_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_training_profile_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
