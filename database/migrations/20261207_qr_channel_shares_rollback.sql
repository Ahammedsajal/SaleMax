DROP TABLE sx_qr_channel_shares;
ALTER TABLE beta_chats
  DROP KEY idx_beta_chats_qr_channel,
  DROP COLUMN origin_instance_unique_id;
