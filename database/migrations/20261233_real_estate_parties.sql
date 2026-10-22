-- Private Real Estate v4 party relationships. Party identities remain in the
-- existing tenant Pipeline; this table stores only a typed property link.
CREATE TABLE sx_real_estate_parties (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  property_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  party_type ENUM('buyer','seller','landlord','tenant','representative') NOT NULL,
  assigned_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('active','closed','withdrawn') NOT NULL DEFAULT 'active',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_real_estate_party_tenant_id (tenant_id,id),
  UNIQUE KEY uq_sx_real_estate_party_link (tenant_id,property_id,legacy_uid_hash,lead_id,party_type),
  KEY idx_sx_real_estate_party_scope (tenant_id,assigned_membership_id,status,updated_at),
  KEY idx_sx_real_estate_party_lead (tenant_id,legacy_uid_hash,lead_id,status),
  CONSTRAINT fk_sx_real_estate_party_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_real_estate_party_property FOREIGN KEY (tenant_id,property_id) REFERENCES sx_real_estate_properties(tenant_id,id),
  CONSTRAINT fk_sx_real_estate_party_created_by FOREIGN KEY (tenant_id,created_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT fk_sx_real_estate_party_updated_by FOREIGN KEY (tenant_id,updated_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id),
  CONSTRAINT fk_sx_real_estate_party_assignee FOREIGN KEY (tenant_id,assigned_membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT ck_sx_real_estate_party_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
