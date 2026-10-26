ALTER TABLE sx_chatbot_conversation_controls
  ADD COLUMN auto_pause_at DATETIME(3) NULL AFTER pause_until,
  ADD KEY sx_chatbot_conversation_auto_pause (mode, auto_pause_at);
