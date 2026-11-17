ALTER TABLE sx_retail_orders
  ADD COLUMN buyer_email VARCHAR(254) DEFAULT NULL,
  ADD KEY ix_sx_retail_orders_email (tenant_id, buyer_email),
  ADD KEY ix_sx_retail_orders_created (tenant_id, created_at);
