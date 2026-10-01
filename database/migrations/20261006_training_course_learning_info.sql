-- Additive, backward-compatible training catalogue learning metadata.
ALTER TABLE sx_training_courses
  ADD COLUMN difficulty_level ENUM('all_levels','beginner','intermediate','advanced','custom') NOT NULL DEFAULT 'all_levels' AFTER delivery_mode,
  ADD COLUMN outcomes_en TEXT NOT NULL DEFAULT '' AFTER difficulty_level,
  ADD COLUMN outcomes_ar TEXT NOT NULL DEFAULT '' AFTER outcomes_en,
  ADD COLUMN prerequisites_en TEXT NOT NULL DEFAULT '' AFTER outcomes_ar,
  ADD COLUMN prerequisites_ar TEXT NOT NULL DEFAULT '' AFTER prerequisites_en;
