-- Store tenant-defined property values with immutable bilingual field snapshots.
-- Existing listings remain NULL and continue to render without custom details.
ALTER TABLE sx_real_estate_properties
  ADD COLUMN custom_fields JSON NULL AFTER description_ar;
