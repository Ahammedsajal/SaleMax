-- Enforce one state row per exact legacy owner/conversation pair. A digest
-- keeps the constraint independent of the legacy VARCHAR widths while the
-- source columns remain available for compatibility and support review.
ALTER TABLE flow_data
  ADD COLUMN owner_key_hash BINARY(32)
    GENERATED ALWAYS AS (
      CASE
        WHEN uid IS NULL OR uniqueId IS NULL THEN NULL
        ELSE UNHEX(SHA2(CONCAT(CAST(CONVERT(uid USING utf8mb4) AS BINARY), 0x00, CAST(CONVERT(uniqueId USING utf8mb4) AS BINARY)), 256))
      END
    ) STORED,
  ADD UNIQUE KEY uq_flow_data_owner_key_hash (owner_key_hash);
