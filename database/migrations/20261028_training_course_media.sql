-- Private, tenant-scoped images, PDFs, and video files attached to courses.
CREATE TABLE sx_training_course_media (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_kind ENUM('image','document','video') NOT NULL,
  mime_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(240) NOT NULL,
  storage_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_size_bytes BIGINT UNSIGNED NOT NULL,
  sha256_hex CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_course_media_tenant_id (tenant_id,id),
  KEY idx_sx_course_media_course (tenant_id,course_id,deleted_at,created_at),
  KEY idx_sx_course_media_usage (tenant_id,deleted_at,file_size_bytes),
  CONSTRAINT fk_sx_course_media_course FOREIGN KEY (tenant_id,course_id) REFERENCES sx_training_courses(tenant_id,id),
  CONSTRAINT fk_sx_course_media_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_sx_course_media_size CHECK (file_size_bytes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
