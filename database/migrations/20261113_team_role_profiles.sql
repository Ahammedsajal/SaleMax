CREATE TABLE sx_team_roles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  description VARCHAR(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  seat_role VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permissions JSON NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_team_roles_tenant_name (tenant_id,name),
  KEY idx_sx_team_roles_tenant_status (tenant_id,status,seat_role),
  CONSTRAINT fk_sx_team_roles_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_team_roles_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT chk_sx_team_roles_seat_role CHECK (seat_role IN ('accountant','manager','agent')),
  CONSTRAINT chk_sx_team_roles_status CHECK (status IN ('active','archived'))
) ENGINE=InnoDB;

ALTER TABLE sx_team_invites
  ADD COLUMN role_profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER role,
  ADD KEY idx_sx_team_invite_role_profile (tenant_id,role_profile_id,status),
  ADD CONSTRAINT fk_sx_team_invite_role_profile FOREIGN KEY (role_profile_id) REFERENCES sx_team_roles(id);

ALTER TABLE sx_memberships
  ADD COLUMN role_profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER role,
  ADD KEY idx_sx_membership_role_profile (tenant_id,role_profile_id,status),
  ADD CONSTRAINT fk_sx_membership_role_profile FOREIGN KEY (role_profile_id) REFERENCES sx_team_roles(id);
