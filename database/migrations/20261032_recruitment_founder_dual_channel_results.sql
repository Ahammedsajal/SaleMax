ALTER TABLE sx_recruitment_founder_notifications
  ADD COLUMN delivery_results JSON NULL AFTER provider_message_id;
