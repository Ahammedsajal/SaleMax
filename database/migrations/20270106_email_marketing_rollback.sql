-- Manual rollback only. Export the Phonebook email/consent data and campaign
-- history before applying; this script removes those records and columns.
DROP TABLE sx_platform_email_provider_settings;
DROP TABLE sx_email_messages;
DROP TABLE sx_email_threads;
DROP TABLE sx_email_consent_events;
DROP TABLE sx_email_suppressions;
DROP TABLE sx_email_campaign_recipients;
DROP TABLE sx_email_campaign_attachments;
DROP TABLE sx_email_campaigns;
DROP TABLE sx_email_template_attachments;
DROP TABLE sx_email_attachments;
DROP TABLE sx_email_templates;
DROP TABLE sx_email_senders;
DROP TABLE sx_email_sender_domains;
ALTER TABLE contact
  DROP INDEX idx_contact_email_owner,
  DROP COLUMN email_unsubscribed_at,
  DROP COLUMN email_marketing_consent_source,
  DROP COLUMN email_marketing_consent_at,
  DROP COLUMN email_marketing_consent,
  DROP COLUMN email;
