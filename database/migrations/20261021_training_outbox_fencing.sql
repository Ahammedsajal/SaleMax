-- Each lease gets a strictly increasing generation so stale workers cannot finish reclaimed work.
ALTER TABLE sx_training_outbox_events
  ADD COLUMN lease_version BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER attempts;
UPDATE sx_training_outbox_events SET lease_version=attempts WHERE attempts>0;

ALTER TABLE sx_training_outbox_attempts
  ADD COLUMN lease_version BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER attempt_number;
UPDATE sx_training_outbox_attempts SET lease_version=attempt_number WHERE attempt_number>0;
ALTER TABLE sx_training_outbox_attempts
  ADD UNIQUE KEY uq_training_outbox_attempt_lease (event_id,lease_version);
