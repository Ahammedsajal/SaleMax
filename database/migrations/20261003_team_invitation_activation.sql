-- Add hashed one-time activation details to existing tenant seat reservations.
ALTER TABLE sx_team_invites
  ADD COLUMN token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN invited_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN accepted_at DATETIME(3) NULL,
  ADD UNIQUE KEY uq_sx_team_invite_token_hash (token_hash),
  ADD KEY idx_sx_team_invite_inviter (invited_by_identity_id,created_at),
  ADD CONSTRAINT fk_sx_team_invite_inviter FOREIGN KEY (invited_by_identity_id) REFERENCES sx_identities(id);
