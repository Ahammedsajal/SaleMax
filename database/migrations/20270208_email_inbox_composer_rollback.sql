-- Apply only before any direct-composed email thread has been created.
-- Preserve all message/thread history before considering this rollback.
DROP TABLE sx_email_outbound_queue;
DROP TABLE sx_email_message_attachments;

ALTER TABLE sx_email_messages
  DROP INDEX uq_sx_email_message_tenant,
  DROP COLUMN updated_at,
  DROP COLUMN draft_revision,
  DROP COLUMN delivery_status,
  DROP COLUMN sender_email;

ALTER TABLE sx_email_threads
  DROP FOREIGN KEY fk_sx_email_thread_sender,
  DROP INDEX idx_sx_email_thread_sender,
  DROP COLUMN sender_id,
  MODIFY campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY contact_id BIGINT UNSIGNED NOT NULL;
