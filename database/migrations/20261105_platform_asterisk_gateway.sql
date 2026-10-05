ALTER TABLE sx_platform_asterisk_config
  ADD COLUMN gateway_host VARCHAR(253) NOT NULL DEFAULT '' AFTER ari_username,
  ADD COLUMN gateway_sip_port SMALLINT UNSIGNED NOT NULL DEFAULT 5061 AFTER gateway_host,
  ADD COLUMN gateway_sip_transport ENUM('udp','tcp','tls') NOT NULL DEFAULT 'tls' AFTER gateway_sip_port,
  ADD COLUMN gateway_endpoint_status ENUM('online','offline','unknown','not_configured') NULL AFTER gateway_sip_transport,
  ADD COLUMN gateway_endpoint_tested_at DATETIME(3) NULL AFTER gateway_endpoint_status;

CREATE TABLE sx_platform_asterisk_gateway_ports (
  channel_no TINYINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  inbound_enabled TINYINT(1) NOT NULL DEFAULT 0,
  outbound_enabled TINYINT(1) NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (channel_no),
  CONSTRAINT ck_sx_platform_asterisk_gateway_channel CHECK (channel_no BETWEEN 1 AND 4),
  CONSTRAINT ck_sx_platform_asterisk_gateway_port_policy CHECK (enabled=1 OR (inbound_enabled=0 AND outbound_enabled=0)),
  FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_platform_asterisk_gateway_ports(channel_no) VALUES (1),(2),(3),(4);
