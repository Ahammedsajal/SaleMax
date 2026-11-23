ALTER TABLE sx_email_bounce_suppressions
  MODIFY COLUMN bounce_type ENUM('Permanent','Transient','Undetermined') NOT NULL;
