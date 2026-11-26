ALTER TABLE sx_email_campaigns
  ADD COLUMN follow_up_of_campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  ALGORITHM=INSTANT;

ALTER TABLE sx_email_campaign_recipients
  ADD COLUMN follow_up_source_recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  ALGORITHM=INSTANT;
