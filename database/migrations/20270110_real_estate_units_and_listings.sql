-- Add physical inventory without replacing the existing listing IDs. Each
-- historical listing maps to its own unit; deduplication requires review.
CREATE TABLE sx_real_estate_buildings (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(160) NOT NULL,
  name_ar VARCHAR(160) NOT NULL DEFAULT '',
  area VARCHAR(100) NOT NULL DEFAULT '',
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_re_building_tenant_id (tenant_id,id),
  KEY idx_re_building_name (tenant_id,name),
  CONSTRAINT fk_re_building_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_re_building_creator FOREIGN KEY (tenant_id,created_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_real_estate_units (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  building_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reference_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(160) NOT NULL,
  name_ar VARCHAR(160) NOT NULL DEFAULT '',
  description_en TEXT NULL,
  description_ar TEXT NULL,
  unit_number VARCHAR(80) NOT NULL DEFAULT '',
  property_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  area VARCHAR(100) NOT NULL DEFAULT '',
  municipality VARCHAR(100) NOT NULL DEFAULT '',
  street VARCHAR(160) NOT NULL DEFAULT '',
  private_address VARCHAR(500) NOT NULL DEFAULT '',
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL,
  floor_label VARCHAR(40) NOT NULL DEFAULT '',
  area_sqm DECIMAL(12,2) NULL,
  bedrooms SMALLINT UNSIGNED NULL,
  bathrooms SMALLINT UNSIGNED NULL,
  furnishing ENUM('unknown','furnished','semi_furnished','unfurnished') NOT NULL DEFAULT 'unknown',
  parking_spaces SMALLINT UNSIGNED NULL,
  available_from DATE NULL,
  amenities JSON NULL,
  owner_name VARCHAR(160) NOT NULL DEFAULT '',
  managing_company VARCHAR(160) NOT NULL DEFAULT '',
  availability ENUM('available','reserved','rented','unavailable') NOT NULL DEFAULT 'available',
  assigned_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_re_unit_tenant_id (tenant_id,id),
  UNIQUE KEY uq_re_unit_reference (tenant_id,reference_code),
  KEY idx_re_unit_inventory (tenant_id,availability,building_id,updated_at),
  KEY idx_re_unit_assignee (tenant_id,assigned_membership_id),
  CONSTRAINT fk_re_unit_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_re_unit_building FOREIGN KEY (tenant_id,building_id) REFERENCES sx_real_estate_buildings(tenant_id,id),
  CONSTRAINT fk_re_unit_assignee FOREIGN KEY (tenant_id,assigned_membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_re_unit_creator FOREIGN KEY (tenant_id,created_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT fk_re_unit_updater FOREIGN KEY (tenant_id,updated_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT ck_re_unit_area CHECK (area_sqm IS NULL OR area_sqm > 0),
  CONSTRAINT ck_re_unit_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT ck_re_unit_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT ck_re_unit_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sx_real_estate_properties
  MODIFY COLUMN property_type ENUM('apartment','house','villa','villa_apartment','townhouse','penthouse','land','commercial','office','warehouse','other') NOT NULL,
  MODIFY COLUMN status ENUM('draft','review','active','paused','reserved','under_offer','sold','rented','expired','withdrawn','archived') NOT NULL DEFAULT 'draft',
  ADD COLUMN unit_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN minimum_term_months SMALLINT UNSIGNED NULL,
  ADD COLUMN deposit_minor BIGINT UNSIGNED NULL,
  ADD COLUMN payment_frequency ENUM('monthly','quarterly','yearly','other') NOT NULL DEFAULT 'monthly',
  ADD COLUMN cheque_count SMALLINT UNSIGNED NULL,
  ADD COLUMN tenant_fee_minor BIGINT UNSIGNED NULL,
  ADD COLUMN fee_payer ENUM('unknown','tenant','owner','manager','none') NOT NULL DEFAULT 'unknown',
  ADD COLUMN included_services JSON NULL,
  ADD COLUMN free_months SMALLINT UNSIGNED NULL,
  ADD COLUMN promotion_terms VARCHAR(1000) NOT NULL DEFAULT '',
  ADD COLUMN last_availability_confirmed_at DATETIME(3) NULL,
  ADD KEY idx_re_listing_unit (tenant_id,unit_id,status),
  ADD CONSTRAINT fk_re_listing_unit FOREIGN KEY (tenant_id,unit_id) REFERENCES sx_real_estate_units(tenant_id,id),
  ADD CONSTRAINT ck_re_listing_term CHECK (minimum_term_months IS NULL OR minimum_term_months > 0);

INSERT INTO sx_real_estate_units
  (id,tenant_id,reference_code,name,property_type,area,area_sqm,bedrooms,bathrooms,availability,assigned_membership_id,created_by_identity_id,updated_by_identity_id,created_at,updated_at)
SELECT id,tenant_id,reference_code,title_en,property_type,city,area_sqm,bedrooms,bathrooms,
  CASE status WHEN 'under_offer' THEN 'reserved' WHEN 'rented' THEN 'rented' WHEN 'sold' THEN 'unavailable' WHEN 'archived' THEN 'unavailable' WHEN 'withdrawn' THEN 'unavailable' ELSE 'available' END,
  NULL,created_by_identity_id,updated_by_identity_id,created_at,updated_at
FROM sx_real_estate_properties;

UPDATE sx_real_estate_properties SET unit_id=id WHERE unit_id IS NULL;

CREATE TABLE sx_real_estate_unit_media (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  unit_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_kind ENUM('image','document','video') NOT NULL,
  mime_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(240) NOT NULL,
  file_size_bytes BIGINT UNSIGNED NOT NULL,
  sha256_hex CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_re_media_tenant_id (tenant_id,id),
  KEY idx_re_media_unit (tenant_id,unit_id,deleted_at,sort_order),
  KEY idx_re_media_usage (tenant_id,file_size_bytes),
  CONSTRAINT fk_re_media_unit FOREIGN KEY (tenant_id,unit_id) REFERENCES sx_real_estate_units(tenant_id,id),
  CONSTRAINT fk_re_media_creator FOREIGN KEY (tenant_id,created_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT ck_re_media_size CHECK (file_size_bytes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
