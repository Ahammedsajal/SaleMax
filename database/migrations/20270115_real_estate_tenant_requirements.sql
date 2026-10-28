-- Tenant preferences extend an existing CRM lead; they do not create a second lead.
CREATE TABLE sx_real_estate_tenant_requirements (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lead_id CHAR(36) NOT NULL,
  areas JSON NOT NULL,
  property_types JSON NOT NULL,
  bedrooms SMALLINT UNSIGNED NULL,
  budget_min_minor BIGINT UNSIGNED NULL,
  budget_max_minor BIGINT UNSIGNED NULL,
  move_in_date DATE NULL,
  lease_months SMALLINT UNSIGNED NULL,
  furnishing ENUM('any','furnished','semi_furnished','unfurnished') NOT NULL DEFAULT 'any',
  amenities JSON NOT NULL,
  included_bills JSON NOT NULL,
  contact_preferences JSON NOT NULL,
  consent ENUM('unknown','granted','declined') NOT NULL DEFAULT 'unknown',
  consent_note VARCHAR(500) NOT NULL DEFAULT '',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,lead_id),
  CONSTRAINT fk_re_requirement_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_re_requirement_lead FOREIGN KEY (lead_id) REFERENCES pipeline_leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_re_requirement_actor FOREIGN KEY (tenant_id,updated_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT ck_re_requirement_budget CHECK (budget_min_minor IS NULL OR budget_max_minor IS NULL OR budget_min_minor <= budget_max_minor),
  CONSTRAINT ck_re_requirement_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_real_estate_lead_units (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lead_id CHAR(36) NOT NULL,
  unit_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  added_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,lead_id,unit_id),
  KEY idx_re_lead_units_unit (tenant_id,unit_id),
  CONSTRAINT fk_re_lead_units_requirement FOREIGN KEY (tenant_id,lead_id) REFERENCES sx_real_estate_tenant_requirements(tenant_id,lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_re_lead_units_unit FOREIGN KEY (tenant_id,unit_id) REFERENCES sx_real_estate_units(tenant_id,id),
  CONSTRAINT fk_re_lead_units_actor FOREIGN KEY (tenant_id,added_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
