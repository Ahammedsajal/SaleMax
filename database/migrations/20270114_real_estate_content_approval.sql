-- Bind marketing approvals to the actual media and listing copy reviewed.
ALTER TABLE sx_real_estate_agreement_units
  ADD COLUMN approved_media_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN approved_description_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
