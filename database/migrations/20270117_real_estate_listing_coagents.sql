CREATE TABLE sx_real_estate_listing_coagents (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  listing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  added_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,listing_id,membership_id),
  KEY idx_re_listing_coagent_member (tenant_id,membership_id,listing_id),
  CONSTRAINT fk_re_listing_coagent_listing FOREIGN KEY (tenant_id,listing_id) REFERENCES sx_real_estate_properties(tenant_id,id),
  CONSTRAINT fk_re_listing_coagent_member FOREIGN KEY (tenant_id,membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_re_listing_coagent_actor FOREIGN KEY (tenant_id,added_by_identity_id) REFERENCES sx_memberships(tenant_id,identity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
