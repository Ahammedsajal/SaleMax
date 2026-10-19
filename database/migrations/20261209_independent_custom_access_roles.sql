-- Role profiles describe access independently; the invitation chooses the licensed account seat.
ALTER TABLE sx_team_roles
  DROP CONSTRAINT chk_sx_team_roles_seat_role,
  MODIFY seat_role VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD CONSTRAINT chk_sx_team_roles_seat_role CHECK (seat_role IS NULL OR seat_role IN ('accountant','manager','team_leader','agent'));
