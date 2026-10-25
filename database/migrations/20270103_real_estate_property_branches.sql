-- Attach listings to business-owned operating branches. Existing listings stay
-- unassigned, and branch ownership remains tenant-qualified.
ALTER TABLE sx_real_estate_properties
  ADD COLUMN branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER city,
  ADD KEY ix_sx_real_estate_branch (tenant_id,branch_id,status,updated_at),
  ADD CONSTRAINT fk_sx_real_estate_branch
    FOREIGN KEY (tenant_id,branch_id) REFERENCES sx_tenant_branches(tenant_id,id);
