-- Store role-wide sidebar visibility separately from API permissions.
-- NULL preserves the existing permission-derived navigation behavior.
ALTER TABLE sx_team_roles ADD COLUMN navigation JSON NULL AFTER permissions;
