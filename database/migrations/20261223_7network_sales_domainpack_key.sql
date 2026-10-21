-- Normalize the saved first-party Sales bot's internal domain-pack key.
-- Its tenant category is already canonical; this repairs the legacy profile value.
UPDATE sx_chatbot_profiles
SET config = JSON_SET(config, '$.domainPack', '7network_sales'),
    revision = revision + 1
WHERE category_key = '7network_sales'
  AND JSON_UNQUOTE(JSON_EXTRACT(config, '$.domainPack')) IN ('salemax_sales', 'salemaxsales');
