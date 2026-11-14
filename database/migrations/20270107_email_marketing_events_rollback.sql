DROP TABLE IF EXISTS sx_email_provider_events;
ALTER TABLE sx_email_campaign_recipients
  DROP INDEX uq_sx_email_recipient_id;
