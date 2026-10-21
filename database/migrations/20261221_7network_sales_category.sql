-- Rename the private first-party Sales category while preserving its v1 plan
-- versions and assignments. The old key remains a read-compatible alias for
-- immutable published plan contracts created before this identity migration.
CREATE TABLE IF NOT EXISTS sx_category_identity_aliases (
  legacy_category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  canonical_category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_version INT UNSIGNED NOT NULL,
  mapped_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (legacy_category_key),
  KEY idx_sx_category_alias_canonical (canonical_category_key,category_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_category_identity_aliases(legacy_category_key,canonical_category_key,category_version)
VALUES ('salemax_sales','7network_sales',1)
ON DUPLICATE KEY UPDATE canonical_category_key=VALUES(canonical_category_key),category_version=VALUES(category_version);

UPDATE sx_tenants SET category_key='7network_sales',revision=revision+1
WHERE category_key='salemax_sales' AND category_version=1;

UPDATE sx_chatbot_profiles SET category_key='7network_sales',revision=revision+1
WHERE category_key='salemax_sales' AND category_version=1;

-- Copy the existing private Sales settings under the canonical key without
-- replacing a newer canonical configuration or discarding the legacy row.
INSERT INTO sx_phonebook_settings(owner_hash,category_key,config_json,revision,updated_at)
SELECT old.owner_hash,'7network_sales',old.config_json,old.revision,old.updated_at
FROM sx_phonebook_settings old
WHERE old.category_key='salemax_sales'
  AND NOT EXISTS (
    SELECT 1 FROM sx_phonebook_settings current
    WHERE current.owner_hash=old.owner_hash AND current.category_key='7network_sales'
  );
