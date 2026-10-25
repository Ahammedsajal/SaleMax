-- Preserve explicit consent evidence for guest requests sent to tenant storefronts.
-- Existing platform enquiries remain valid and retain NULL consent metadata.
ALTER TABLE sx_website_enquiries
  ADD COLUMN consented_at DATETIME(3) NULL AFTER payload_hash,
  ADD COLUMN consent_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER consented_at;
