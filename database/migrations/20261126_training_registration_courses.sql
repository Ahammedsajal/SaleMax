-- One signed application can register a learner for several distinct courses.
-- Existing registrations remain the first course on their application.
ALTER TABLE sx_training_registrations
 ADD COLUMN course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN course_position SMALLINT UNSIGNED NOT NULL DEFAULT 1;

UPDATE sx_training_registrations r
 JOIN sx_training_sale_reviews v ON v.tenant_id=r.tenant_id AND v.id=r.sale_review_id
 SET r.course_id=v.course_id;

ALTER TABLE sx_training_registrations
 MODIFY COLUMN course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 ADD KEY idx_registration_submission(tenant_id,submission_id),
 DROP INDEX uq_registration_submission,
 ADD UNIQUE KEY uq_registration_submission_course(tenant_id,submission_id,course_id),
 ADD UNIQUE KEY uq_registration_submission_position(tenant_id,submission_id,course_position),
 ADD CONSTRAINT fk_registration_course FOREIGN KEY (tenant_id,course_id) REFERENCES sx_training_courses(tenant_id,id);
