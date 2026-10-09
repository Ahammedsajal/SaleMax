-- Registration stays pending until the existing sale approval and invoice workflow completes.
ALTER TABLE sx_training_courses ADD COLUMN student_id_prefix VARCHAR(40) NULL;
ALTER TABLE sx_training_form_submissions ADD UNIQUE KEY uq_form_submission_tenant_id(tenant_id,id);
CREATE TABLE IF NOT EXISTS sx_training_student_sequences (
 tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 prefix VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 period_year SMALLINT UNSIGNED NOT NULL,
 last_value BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(tenant_id,prefix,period_year),
 FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sx_training_registrations (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 sale_review_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 student_number VARCHAR(100) NOT NULL,
 provisional_invoice_number VARCHAR(110) NOT NULL,
 snapshot_json JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id), UNIQUE KEY uq_registration_submission(tenant_id,submission_id),
 UNIQUE KEY uq_registration_student(tenant_id,student_number),
 UNIQUE KEY uq_registration_review(tenant_id,sale_review_id),
 FOREIGN KEY (tenant_id,submission_id) REFERENCES sx_training_form_submissions(tenant_id,id),
 FOREIGN KEY (tenant_id,sale_review_id) REFERENCES sx_training_sale_reviews(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sx_training_registration_deliveries (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 recipient_kind ENUM('candidate','owner','accountant') NOT NULL,
 recipient_id VARCHAR(128) NOT NULL,
 channel ENUM('email','whatsapp') NOT NULL,
 event_type ENUM('registration_submitted','invoice_issued') NOT NULL DEFAULT 'registration_submitted',
 status ENUM('pending','blocked','sending','accepted','failed','unknown') NOT NULL DEFAULT 'pending',
 error_code VARCHAR(100) NULL,
 provider_message_id VARCHAR(191) NULL,
 attempt_id CHAR(36) NULL,
 attempted_at DATETIME(3) NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(id), UNIQUE KEY uq_registration_delivery(registration_id,recipient_kind,recipient_id,channel,event_type),
 KEY idx_registration_delivery_queue(status,updated_at),
 FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
 FOREIGN KEY (registration_id) REFERENCES sx_training_registrations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
