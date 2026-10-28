CREATE TABLE sx_real_estate_agent_profiles (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  working_areas JSON NOT NULL,
  languages JSON NOT NULL,
  seniority ENUM('agent','senior') NOT NULL DEFAULT 'agent',
  public_enabled TINYINT(1) NOT NULL DEFAULT 0,
  public_bio_en VARCHAR(1000) NOT NULL DEFAULT '',
  public_bio_ar VARCHAR(1000) NOT NULL DEFAULT '',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,membership_id),
  CONSTRAINT fk_re_agent_profile_member FOREIGN KEY (tenant_id,membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_re_agent_profile_actor FOREIGN KEY (tenant_id,updated_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT ck_re_agent_profile_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Immutable entries preserve each override and its reason. The most recently
-- recorded entry is the current rule for a member and optional listing.
CREATE TABLE sx_real_estate_agent_commission_rules (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  listing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  basis ENUM('first_month_percent','fixed_qar') NOT NULL,
  value_minor_or_bps BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_re_agent_rule_sequence (sequence_id),
  KEY idx_re_agent_rules_history (tenant_id,membership_id,listing_id,created_at),
  CONSTRAINT fk_re_agent_rule_member FOREIGN KEY (tenant_id,membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_re_agent_rule_listing FOREIGN KEY (tenant_id,listing_id) REFERENCES sx_real_estate_properties(tenant_id,id),
  CONSTRAINT fk_re_agent_rule_actor FOREIGN KEY (tenant_id,created_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT ck_re_agent_rule_value CHECK ((basis='first_month_percent' AND value_minor_or_bps<=10000) OR (basis='fixed_qar' AND value_minor_or_bps<=999999999999))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
