ALTER TABLE beta_chats
  ADD COLUMN origin_instance_unique_id VARCHAR(255) NULL,
  ADD KEY idx_beta_chats_qr_channel (uid, origin_instance_unique_id);

UPDATE beta_chats chat
JOIN (
  SELECT uid, normalized_number, MIN(uniqueId) AS unique_id
  FROM (
    SELECT uid, uniqueId,
      REGEXP_REPLACE(number, '[^0-9]', '') AS normalized_number
    FROM instance
    WHERE uniqueId IS NOT NULL AND uniqueId <> '' AND number IS NOT NULL AND number <> ''
  ) numbered
  GROUP BY uid, normalized_number
  HAVING COUNT(*) = 1
) channel ON channel.uid = chat.uid
  AND channel.normalized_number = REGEXP_REPLACE(
    SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(chat.origin_instance_id, '$.id')), ':', 1), '@', 1),
    '[^0-9]', ''
  )
SET chat.origin_instance_unique_id = channel.unique_id
WHERE chat.origin = 'qr' AND chat.origin_instance_unique_id IS NULL;

CREATE TABLE sx_qr_channel_shares (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  instance_id INT(11) NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  granted_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instance_id, membership_id),
  KEY idx_sx_qr_channel_share_member (tenant_id, membership_id),
  CONSTRAINT fk_sx_qr_channel_share_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_qr_channel_share_member FOREIGN KEY (tenant_id, membership_id) REFERENCES sx_memberships(tenant_id, id),
  CONSTRAINT fk_sx_qr_channel_share_instance FOREIGN KEY (instance_id) REFERENCES instance(id),
  CONSTRAINT fk_sx_qr_channel_share_actor FOREIGN KEY (granted_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
