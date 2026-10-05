-- Add enrollment-level trainer assignment and auditable daily attendance.
ALTER TABLE sx_training_enrollments
  ADD COLUMN trainer_name VARCHAR(255) NULL AFTER batch_id;

CREATE TABLE sx_training_student_attendance (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enrollment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_date DATE NOT NULL,
  attendance_status ENUM('present','absent','excused') NOT NULL,
  note VARCHAR(500) NULL,
  marked_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  marked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_attendance_day (tenant_id,enrollment_id,session_date),
  KEY idx_training_attendance_student (tenant_id,enrollment_id,session_date),
  CONSTRAINT fk_training_attendance_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_attendance_enrollment FOREIGN KEY (tenant_id,enrollment_id) REFERENCES sx_training_enrollments(tenant_id,id),
  CONSTRAINT fk_training_attendance_actor FOREIGN KEY (marked_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
