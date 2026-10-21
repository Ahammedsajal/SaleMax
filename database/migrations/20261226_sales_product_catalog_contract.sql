-- Give Sales products and services first-class domain fields. Course-only
-- columns remain during the compatibility window so an older reader can be
-- restored without losing product records.
ALTER TABLE sx_product_catalog
  ADD COLUMN item_kind ENUM('product','service','unclassified') NOT NULL DEFAULT 'unclassified' AFTER code,
  ADD COLUMN tags_json JSON NULL AFTER source_categories,
  MODIFY COLUMN duration_value SMALLINT UNSIGNED NULL,
  MODIFY COLUMN duration_unit ENUM('hours','days','weeks','months') NULL,
  MODIFY COLUMN delivery_mode ENUM('in_person','online','hybrid') NULL,
  MODIFY COLUMN difficulty_level ENUM('all_levels','beginner','intermediate','advanced','custom') NULL,
  MODIFY COLUMN outcomes_en TEXT NULL,
  MODIFY COLUMN outcomes_ar TEXT NULL,
  MODIFY COLUMN prerequisites_en TEXT NULL,
  MODIFY COLUMN prerequisites_ar TEXT NULL;
