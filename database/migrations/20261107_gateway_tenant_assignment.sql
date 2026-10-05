ALTER TABLE sx_platform_asterisk_gateway_ports
  ADD COLUMN tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER channel_no,
  ADD COLUMN inbound_did VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER tenant_id,
  ADD UNIQUE KEY uq_sx_asterisk_gateway_inbound_did (inbound_did),
  ADD KEY idx_sx_asterisk_gateway_tenant (tenant_id,enabled,inbound_enabled,outbound_enabled),
  ADD CONSTRAINT fk_sx_asterisk_gateway_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  ADD CONSTRAINT ck_sx_asterisk_gateway_tenant_required CHECK (enabled=0 OR tenant_id IS NOT NULL),
  ADD CONSTRAINT ck_sx_asterisk_gateway_inbound_did CHECK (inbound_did IS NULL OR inbound_did REGEXP '^\\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT ck_sx_asterisk_gateway_inbound_ready CHECK (inbound_enabled=0 OR inbound_did IS NOT NULL),
  ADD CONSTRAINT ck_sx_asterisk_gateway_unassigned CHECK (tenant_id IS NOT NULL OR (enabled=0 AND inbound_enabled=0 AND outbound_enabled=0 AND inbound_did IS NULL));
