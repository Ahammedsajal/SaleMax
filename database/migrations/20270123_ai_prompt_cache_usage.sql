-- Additive usage telemetry. Historical costs remain unchanged; new requests
-- distinguish ordinary input, cache reads and cache writes. No reply ceiling.
ALTER TABLE sx_chatbot_usage_monthly
  ADD COLUMN cached_input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN cache_write_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN cache_read_savings_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN cache_write_premium_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN provider_requests BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN cache_read_requests BIGINT UNSIGNED NOT NULL DEFAULT 0;
