ALTER TABLE sx_retail_external_orders
  ADD COLUMN source_created_at DATETIME(3) DEFAULT NULL AFTER source_updated_at,
  ADD KEY ix_retail_external_orders_created (tenant_id,source_created_at,connection_id,external_order_id);
