-- Record the real learner lifecycle after a lead becomes an enrollment.
ALTER TABLE sx_training_enrollments
  MODIFY COLUMN status ENUM('reserved','requested','confirmed','started','cancelled','completed') NOT NULL,
  ADD COLUMN started_at DATETIME(3) NULL AFTER status,
  ADD COLUMN completed_at DATETIME(3) NULL AFTER started_at;

CREATE TABLE sx_training_enrollment_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enrollment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type ENUM('course_started','course_completed','certificate_issued') NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  details_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_training_enrollment_events (tenant_id,enrollment_id,created_at),
  CONSTRAINT fk_training_enrollment_event_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_enrollment_event_enrollment FOREIGN KEY (tenant_id,enrollment_id) REFERENCES sx_training_enrollments(tenant_id,id),
  CONSTRAINT fk_training_enrollment_event_actor FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_training_certificates (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enrollment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  certificate_number VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  learner_name_snapshot VARCHAR(255) NOT NULL,
  course_name_en_snapshot VARCHAR(200) NOT NULL,
  course_name_ar_snapshot VARCHAR(200) NOT NULL,
  issued_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_certificate_enrollment (tenant_id,enrollment_id),
  UNIQUE KEY uq_training_certificate_number (tenant_id,certificate_number),
  CONSTRAINT fk_training_certificate_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_training_certificate_enrollment FOREIGN KEY (tenant_id,enrollment_id) REFERENCES sx_training_enrollments(tenant_id,id),
  CONSTRAINT fk_training_certificate_issuer FOREIGN KEY (issued_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
