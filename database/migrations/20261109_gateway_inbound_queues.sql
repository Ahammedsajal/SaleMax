ALTER TABLE sx_platform_asterisk_gateway_ports
  ADD COLUMN inbound_queue_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER inbound_did,
  ADD KEY idx_sx_asterisk_gateway_inbound_queue (tenant_id,inbound_queue_id),
  ADD CONSTRAINT fk_sx_asterisk_gateway_inbound_queue FOREIGN KEY (tenant_id,inbound_queue_id)
    REFERENCES sx_telephony_queues(tenant_id,id);
