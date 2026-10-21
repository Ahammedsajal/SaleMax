-- Move first-party Sales chatbot display copy to the canonical 7Network brand.
-- The legacy category alias and saved JSON keys remain readable for history.
UPDATE sx_chatbot_profiles
SET name = REPLACE(name, 'SaleMaX', '7Network'),
    config = REPLACE(
      REPLACE(CAST(config AS CHAR CHARACTER SET utf8mb4), 'SaleMaX', '7Network'),
      'salemaxsales', '7network_sales'
    ),
    revision = revision + 1
WHERE category_key = '7network_sales'
  AND (
    LOWER(name) LIKE '%salemax%'
    OR LOWER(CAST(config AS CHAR CHARACTER SET utf8mb4)) LIKE '%salemax%'
  );
