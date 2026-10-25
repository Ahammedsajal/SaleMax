-- A business must explicitly approve a PDF before it is exposed by its storefront.
ALTER TABLE sx_training_course_media
  ADD UNIQUE KEY uq_sx_course_media_tenant_course_id (tenant_id,course_id,id);

CREATE TABLE sx_training_public_brochures (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approved_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,course_id),
  UNIQUE KEY uq_sx_training_public_brochure_media (tenant_id,course_id,media_id),
  CONSTRAINT fk_sx_training_public_brochure_course FOREIGN KEY (tenant_id,course_id)
    REFERENCES sx_training_courses(tenant_id,id),
  CONSTRAINT fk_sx_training_public_brochure_media FOREIGN KEY (tenant_id,course_id,media_id)
    REFERENCES sx_training_course_media(tenant_id,course_id,id),
  CONSTRAINT fk_sx_training_public_brochure_approver FOREIGN KEY (approved_by_identity_id)
    REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
