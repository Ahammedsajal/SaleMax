-- Branch-level preparation estimate used by food-service ordering. Zero means
-- the business has not configured an estimate; consumers must not infer an SLA.
ALTER TABLE sx_tenant_branches
  ADD COLUMN preparation_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER opening_hours,
  ADD CONSTRAINT ck_sx_tenant_branch_preparation_minutes CHECK (preparation_minutes <= 240);
