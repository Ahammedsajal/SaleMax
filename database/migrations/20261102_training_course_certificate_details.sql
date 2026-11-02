-- Optional, owner-entered course certificate facts for the training catalogue.
-- Empty values deliberately keep certificate questions on the staff handoff path.
ALTER TABLE sx_training_courses
  ADD COLUMN certificate_details_en TEXT NOT NULL DEFAULT '' AFTER prerequisites_ar,
  ADD COLUMN certificate_details_ar TEXT NOT NULL DEFAULT '' AFTER certificate_details_en;
