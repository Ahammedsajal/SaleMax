-- Preserve campaign attribution per immutable submission so repeat submissions
-- can be compared chronologically without overwriting the lead's current state.
ALTER TABLE sx_training_form_submissions
  ADD COLUMN attribution_json JSON NULL AFTER submission_data;
