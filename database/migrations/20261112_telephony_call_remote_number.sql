ALTER TABLE sx_telephony_calls
  ADD COLUMN remote_number VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER lead_id;
