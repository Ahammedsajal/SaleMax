-- Tenant-scoped blind indexes enable exact email/phone lookup without storing
-- searchable contact values outside the encrypted WooCommerce snapshots.
ALTER TABLE sx_retail_external_customers
  ADD COLUMN email_lookup_hash BINARY(32) DEFAULT NULL AFTER customer_auth_tag,
  ADD COLUMN phone_lookup_hash BINARY(32) DEFAULT NULL AFTER email_lookup_hash,
  ADD KEY ix_retail_external_customer_email (tenant_id,connection_id,email_lookup_hash),
  ADD KEY ix_retail_external_customer_phone (tenant_id,connection_id,phone_lookup_hash);
