ALTER TABLE sx_recruitment_applications
  ADD COLUMN linked_chat_id VARCHAR(999) NULL AFTER linked_lead_id,
  ADD COLUMN linked_chat_origin ENUM('qr','meta') NULL AFTER linked_chat_id;
