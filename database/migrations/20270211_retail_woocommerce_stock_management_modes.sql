-- WooCommerce variation manage_stock can be true, false, or "parent".
-- Existing boolean snapshots cannot distinguish parent-managed stock, so they
-- remain unknown until a fresh source sync records the explicit API mode.
ALTER TABLE sx_retail_external_products
  ADD COLUMN source_stock_management ENUM('unknown','managed','unmanaged','parent') CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown' AFTER source_stock_managed;

ALTER TABLE sx_retail_external_product_variants
  ADD COLUMN source_stock_management ENUM('unknown','managed','unmanaged','parent') CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown' AFTER source_stock_managed;
