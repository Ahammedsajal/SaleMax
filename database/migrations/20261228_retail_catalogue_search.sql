-- Keep the shared product catalogue searchable at tenant scope for large Retail inventories.
-- Name search uses a documented prefix contract so these B-tree indexes remain useful.
ALTER TABLE sx_product_catalog
  ADD KEY idx_sx_product_tenant_status_code (tenant_id,status,code,id),
  ADD KEY idx_sx_product_tenant_status_name_en (tenant_id,status,name_en,code,id),
  ADD KEY idx_sx_product_tenant_status_name_ar (tenant_id,status,name_ar,code,id);
