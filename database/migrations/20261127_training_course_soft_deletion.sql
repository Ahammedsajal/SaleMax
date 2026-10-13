-- Remove courses from active use without breaking immutable lead, enrollment,
-- generated invoice, and accounting history that references the course ID.
ALTER TABLE sx_training_courses
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER status,
  ADD KEY idx_sx_training_course_deleted (tenant_id,deleted_at,status,updated_at);
