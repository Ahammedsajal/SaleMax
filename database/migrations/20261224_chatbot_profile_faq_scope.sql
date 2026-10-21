ALTER TABLE sx_chatbot_faqs
  ADD COLUMN profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER tenant_id,
  ADD KEY ix_sx_chatbot_faqs_profile_active_position (tenant_id,profile_id,is_active,position,created_at),
  ADD CONSTRAINT fk_sx_chatbot_faqs_profile
    FOREIGN KEY (tenant_id,profile_id) REFERENCES sx_chatbot_profiles(tenant_id,id) ON DELETE CASCADE;
