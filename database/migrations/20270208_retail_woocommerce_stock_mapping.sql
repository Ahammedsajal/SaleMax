ALTER TABLE sx_retail_external_products
  ADD COLUMN source_stock_managed TINYINT(1) NULL DEFAULT NULL AFTER product_auth_tag,
  ADD COLUMN source_stock_quantity DECIMAL(20,6) NULL DEFAULT NULL AFTER source_stock_managed,
  ADD COLUMN source_stock_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL AFTER source_stock_quantity;

ALTER TABLE sx_retail_external_product_variants
  ADD COLUMN source_stock_managed TINYINT(1) NULL DEFAULT NULL AFTER variant_auth_tag,
  ADD COLUMN source_stock_quantity DECIMAL(20,6) NULL DEFAULT NULL AFTER source_stock_managed,
  ADD COLUMN source_stock_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL AFTER source_stock_quantity;

ALTER TABLE sx_retail_external_product_mappings
  ADD COLUMN stock_scope ENUM('unverified','single_location','aggregate') CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unverified' AFTER target_product_id,
  ADD COLUMN target_location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL AFTER stock_scope,
  ADD COLUMN source_unit_confirmed TINYINT(1) NOT NULL DEFAULT 0 AFTER target_location_id,
  ADD COLUMN target_unit_revision INT UNSIGNED DEFAULT NULL AFTER source_unit_confirmed,
  ADD KEY ix_retail_external_mapping_location (tenant_id,target_location_id),
  ADD CONSTRAINT fk_retail_external_mapping_location FOREIGN KEY (tenant_id,target_location_id)
    REFERENCES sx_retail_locations(tenant_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_retail_external_mapping_stock_scope CHECK (
    (stock_scope='unverified' AND target_location_id IS NULL AND source_unit_confirmed=0 AND target_unit_revision IS NULL) OR
    (stock_scope='single_location' AND target_location_id IS NOT NULL AND source_unit_confirmed=1 AND target_unit_revision IS NOT NULL) OR
    (stock_scope='aggregate' AND target_location_id IS NULL AND source_unit_confirmed=1 AND target_unit_revision IS NOT NULL)
  );
