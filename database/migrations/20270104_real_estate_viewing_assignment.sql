-- Retain the request's resolved business member so later property/branch route
-- changes do not silently transfer already-submitted customer requests.
ALTER TABLE sx_real_estate_viewing_requests
  ADD COLUMN assigned_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER lead_id,
  ADD KEY ix_sx_re_viewing_assigned_queue (tenant_id,assigned_membership_id,status,created_at),
  ADD CONSTRAINT fk_sx_re_viewing_assigned_member
    FOREIGN KEY (tenant_id,assigned_membership_id) REFERENCES sx_memberships(tenant_id,id);
