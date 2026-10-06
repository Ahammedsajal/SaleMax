ALTER TABLE sx_telephony_gateways
  ADD UNIQUE KEY uq_sx_telephony_gateway_tenant_id (tenant_id,id);

ALTER TABLE sx_telephony_calls
  ADD COLUMN gateway_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER status,
  ADD COLUMN gateway_lease_scope CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    DEFAULT '00000000-0000-0000-0000-000000000000' AFTER gateway_id,
  DROP INDEX uq_sx_telephony_call_active_gateway_channel,
  ADD UNIQUE KEY uq_sx_telephony_call_active_gateway_channel (gateway_lease_scope,leased_channel_no),
  ADD KEY idx_sx_telephony_call_gateway (tenant_id,gateway_id,status),
  ADD CONSTRAINT fk_sx_telephony_call_gateway FOREIGN KEY (tenant_id,gateway_id) REFERENCES sx_telephony_gateways(tenant_id,id);
