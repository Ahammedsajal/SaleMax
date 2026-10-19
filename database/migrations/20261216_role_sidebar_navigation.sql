-- Reuse the existing nullable role navigation field where already provisioned.
ALTER TABLE sx_team_roles ADD COLUMN IF NOT EXISTS navigation JSON NULL;
