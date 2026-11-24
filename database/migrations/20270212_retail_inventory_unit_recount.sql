-- Preserve the unit context of historic movements and support an audited
-- per-location physical recount when a legacy SKU must move from generic units
-- to an approved base unit. No unit conversion is inferred.
ALTER TABLE sx_business_stock_movements
  ADD COLUMN previous_unit_revision INT UNSIGNED NOT NULL DEFAULT 0 AFTER previous_revision,
  ADD COLUMN unit_revision INT UNSIGNED NOT NULL DEFAULT 0 AFTER previous_unit_revision,
  ADD COLUMN unit_rebase_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL AFTER reason,
  ADD KEY ix_business_stock_unit_rebase (tenant_id,unit_rebase_id);

CREATE TABLE sx_retail_product_inventory_unit_versions (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  base_unit_code ENUM('unit','yard','piece','panel','custom') CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  base_unit_label VARCHAR(24) NOT NULL DEFAULT '',
  base_unit_label_ar VARCHAR(24) NOT NULL DEFAULT '',
  quantity_precision TINYINT UNSIGNED NOT NULL DEFAULT 0,
  quantity_increment DECIMAL(20,6) UNSIGNED NOT NULL DEFAULT 1.000000,
  change_reason ENUM('legacy_default','configured','physical_recount') NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,product_id,revision),
  CONSTRAINT fk_retail_unit_version_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_retail_unit_version_actor FOREIGN KEY (actor_identity_id)
    REFERENCES sx_identities(id),
  CONSTRAINT ck_retail_unit_version_precision CHECK (quantity_precision<=6),
  CONSTRAINT ck_retail_unit_version_increment CHECK (quantity_increment>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_retail_product_inventory_unit_versions
  (tenant_id,product_id,revision,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,change_reason,actor_identity_id)
SELECT DISTINCT tenant_id,product_id,0,'unit','','',0,1.000000,'legacy_default',NULL
FROM sx_business_stock_movements;

INSERT INTO sx_retail_product_inventory_unit_versions
  (tenant_id,product_id,revision,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,change_reason,actor_identity_id)
SELECT tenant_id,product_id,revision,base_unit_code,base_unit_label,base_unit_label_ar,quantity_precision,quantity_increment,'configured',updated_by_identity_id
FROM sx_retail_product_inventory_units
ON DUPLICATE KEY UPDATE base_unit_code=VALUES(base_unit_code),base_unit_label=VALUES(base_unit_label),
  base_unit_label_ar=VALUES(base_unit_label_ar),quantity_precision=VALUES(quantity_precision),quantity_increment=VALUES(quantity_increment),
  change_reason='configured',actor_identity_id=VALUES(actor_identity_id);

-- Movements written before this migration did not record unit revisions. A
-- SKU's unit profile is locked once it has stock or orders, so its current
-- profile is the known unit for those existing movements.
UPDATE sx_business_stock_movements m
JOIN sx_retail_product_inventory_units u ON u.tenant_id=m.tenant_id AND u.product_id=m.product_id
SET m.previous_unit_revision=u.revision,m.unit_revision=u.revision;

CREATE TABLE sx_retail_inventory_unit_rebases (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_revision INT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  previous_profile_json JSON NOT NULL,
  profile_json JSON NOT NULL,
  reason VARCHAR(200) NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_retail_unit_rebase_request (tenant_id,product_id,request_id),
  UNIQUE KEY uq_retail_unit_rebase_tenant_id (tenant_id,id),
  KEY ix_retail_unit_rebase_product (tenant_id,product_id,created_at),
  CONSTRAINT fk_retail_unit_rebase_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_retail_unit_rebase_actor FOREIGN KEY (actor_identity_id)
    REFERENCES sx_identities(id),
  CONSTRAINT fk_retail_unit_rebase_previous_version FOREIGN KEY (tenant_id,product_id,previous_revision)
    REFERENCES sx_retail_product_inventory_unit_versions(tenant_id,product_id,revision),
  CONSTRAINT fk_retail_unit_rebase_new_version FOREIGN KEY (tenant_id,product_id,revision)
    REFERENCES sx_retail_product_inventory_unit_versions(tenant_id,product_id,revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sx_business_stock_movements
  ADD CONSTRAINT fk_business_stock_unit_rebase FOREIGN KEY (tenant_id,unit_rebase_id)
    REFERENCES sx_retail_inventory_unit_rebases(tenant_id,id);
