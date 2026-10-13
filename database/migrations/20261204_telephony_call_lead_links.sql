ALTER TABLE sx_telephony_calls
  ADD COLUMN lead_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER answered_by_membership_id,
  ADD COLUMN lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER lead_uid_hash,
  ADD KEY idx_sx_telephony_calls_lead (tenant_id,lead_uid_hash,lead_id,started_at),
  ADD CONSTRAINT ck_sx_telephony_call_lead_pair CHECK ((lead_uid_hash IS NULL AND lead_id IS NULL) OR (lead_uid_hash IS NOT NULL AND lead_id IS NOT NULL));
