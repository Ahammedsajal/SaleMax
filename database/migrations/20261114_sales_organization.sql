ALTER TABLE sx_memberships
  MODIFY COLUMN role ENUM('owner','accountant','manager','team_leader','agent') NOT NULL;

ALTER TABLE sx_team_invites
  MODIFY COLUMN role ENUM('accountant','manager','team_leader','agent') NOT NULL;

ALTER TABLE sx_team_roles
  DROP CONSTRAINT chk_sx_team_roles_seat_role,
  ADD CONSTRAINT chk_sx_team_roles_seat_role CHECK (seat_role IN ('accountant','manager','team_leader','agent'));

CREATE TABLE sx_sales_org_history (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  manager_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  team_leader_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  current_membership_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN ended_at IS NULL THEN RTRIM(membership_id) ELSE NULL END) PERSISTENT,
  assigned_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_sales_org_current_member (current_membership_id),
  KEY idx_sx_sales_org_manager (tenant_id,manager_membership_id,ended_at),
  KEY idx_sx_sales_org_leader (tenant_id,team_leader_membership_id,ended_at),
  KEY idx_sx_sales_org_member_history (tenant_id,membership_id,started_at),
  CONSTRAINT fk_sx_sales_org_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_sales_org_member FOREIGN KEY (tenant_id,membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_sx_sales_org_manager FOREIGN KEY (tenant_id,manager_membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_sx_sales_org_leader FOREIGN KEY (tenant_id,team_leader_membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_sx_sales_org_actor FOREIGN KEY (assigned_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT chk_sx_sales_org_dates CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT chk_sx_sales_org_leader_requires_manager CHECK (team_leader_membership_id IS NULL OR manager_membership_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
