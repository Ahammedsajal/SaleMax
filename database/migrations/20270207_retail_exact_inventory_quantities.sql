-- Preserve existing whole-unit balances while giving each retail SKU a
-- precise, non-converting base unit and per-location reorder threshold.
ALTER TABLE sx_business_stock_movements
  MODIFY previous_quantity DECIMAL(20,6) UNSIGNED NOT NULL,
  MODIFY quantity DECIMAL(20,6) UNSIGNED NOT NULL;

ALTER TABLE sx_retail_stock_reservations
  MODIFY quantity DECIMAL(20,6) UNSIGNED NOT NULL;

ALTER TABLE sx_retail_stock_transfers
  MODIFY quantity DECIMAL(20,6) UNSIGNED NOT NULL;

ALTER TABLE sx_retail_return_lines
  MODIFY quantity DECIMAL(20,6) UNSIGNED NOT NULL;

CREATE TABLE sx_retail_product_inventory_units (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  base_unit_code ENUM('unit','yard','piece','panel','custom') CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unit',
  base_unit_label VARCHAR(24) NOT NULL DEFAULT '',
  base_unit_label_ar VARCHAR(24) NOT NULL DEFAULT '',
  quantity_precision TINYINT UNSIGNED NOT NULL DEFAULT 0,
  quantity_increment DECIMAL(20,6) UNSIGNED NOT NULL DEFAULT 1.000000,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,product_id),
  CONSTRAINT fk_retail_inventory_unit_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_retail_inventory_unit_updater FOREIGN KEY (updated_by_identity_id)
    REFERENCES sx_identities(id),
  CONSTRAINT ck_retail_inventory_unit_precision CHECK (quantity_precision<=6),
  CONSTRAINT ck_retail_inventory_unit_custom_label CHECK (base_unit_code<>'custom' OR CHAR_LENGTH(TRIM(base_unit_label))>0),
  CONSTRAINT ck_retail_inventory_unit_increment CHECK (quantity_increment>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_inventory_location_thresholds (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  low_stock_threshold DECIMAL(20,6) UNSIGNED DEFAULT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,product_id,location_id),
  CONSTRAINT fk_retail_inventory_threshold_product FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_product_catalog(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_retail_inventory_threshold_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES sx_retail_locations(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_retail_inventory_threshold_updater FOREIGN KEY (updated_by_identity_id)
    REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
