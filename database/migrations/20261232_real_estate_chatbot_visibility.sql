ALTER TABLE sx_real_estate_properties
  ADD COLUMN chatbot_visible TINYINT(1) NOT NULL DEFAULT 0,
  ADD KEY idx_sx_real_estate_chatbot (tenant_id,status,chatbot_visible,updated_at),
  ADD CONSTRAINT ck_sx_real_estate_chatbot_visible CHECK (chatbot_visible IN (0,1));
