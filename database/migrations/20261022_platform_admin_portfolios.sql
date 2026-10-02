-- Delegated administrators receive isolated customer portfolios. Super Admin
-- keeps platform-wide visibility; customers without a managed-by assignment
-- stay private to Super Admin until explicitly assigned.
ALTER TABLE sx_platform_memberships
  MODIFY role ENUM('super_admin','platform_admin','staff') NOT NULL,
  ADD COLUMN reports_to_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER role,
  ADD KEY idx_sx_platform_reports_to (reports_to_identity_id),
  ADD CONSTRAINT fk_sx_platform_reports_to FOREIGN KEY (reports_to_identity_id) REFERENCES sx_identities(id);

ALTER TABLE sx_platform_staff_invites
  ADD COLUMN platform_role ENUM('platform_admin','staff') NOT NULL DEFAULT 'staff' AFTER identity_id,
  ADD COLUMN reports_to_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER platform_role,
  ADD KEY idx_sx_staff_invites_reports_to (reports_to_identity_id),
  ADD CONSTRAINT fk_sx_staff_invites_reports_to FOREIGN KEY (reports_to_identity_id) REFERENCES sx_identities(id);

CREATE TABLE sx_platform_user_portfolios (
  legacy_user_id INT NOT NULL,
  managed_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source ENUM('admin_created','staff_created','super_admin_created','super_admin_assigned') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (legacy_user_id),
  KEY idx_sx_platform_portfolio_owner (managed_by_identity_id,legacy_user_id),
  CONSTRAINT fk_sx_platform_portfolio_owner FOREIGN KEY (managed_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_sx_platform_portfolio_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
