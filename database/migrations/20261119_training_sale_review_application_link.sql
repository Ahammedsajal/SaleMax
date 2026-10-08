ALTER TABLE sx_training_sale_reviews
  ADD COLUMN application_submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER lead_id,
  ADD KEY ix_training_sale_reviews_application (tenant_id, application_submission_id);

ALTER TABLE sx_training_form_submissions
  ADD KEY ix_training_form_submissions_lead (tenant_id, lead_id, created_at);
