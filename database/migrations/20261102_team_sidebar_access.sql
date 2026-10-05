ALTER TABLE sx_memberships
  ADD COLUMN assigned_navigation JSON NULL AFTER delegated_permissions;
