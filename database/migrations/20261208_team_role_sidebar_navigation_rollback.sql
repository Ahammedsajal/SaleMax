-- Restore permission-derived sidebar visibility for all roles.
ALTER TABLE sx_team_roles DROP COLUMN navigation;
