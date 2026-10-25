-- Attach each scheduled Training Center batch to an optional tenant branch.
-- The tenant-qualified FK prevents cross-business branch assignment.
ALTER TABLE sx_training_batches
  ADD COLUMN branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER course_id,
  ADD KEY ix_sx_training_batches_branch (tenant_id,branch_id),
  ADD CONSTRAINT fk_sx_training_batches_branch
    FOREIGN KEY (tenant_id,branch_id) REFERENCES sx_tenant_branches(tenant_id,id);
