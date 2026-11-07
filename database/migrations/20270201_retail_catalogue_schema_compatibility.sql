-- Keep the Retail clone compatible with shared catalogue queries after Training schema extensions.
ALTER TABLE sx_product_catalog
  ADD COLUMN IF NOT EXISTS certificate_details_en TEXT NOT NULL DEFAULT '' AFTER prerequisites_ar,
  ADD COLUMN IF NOT EXISTS certificate_details_ar TEXT NOT NULL DEFAULT '' AFTER certificate_details_en;
