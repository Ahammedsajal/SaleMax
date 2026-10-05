ALTER TABLE sx_chatbot_turns
  ADD COLUMN error_stage VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER result_class,
  ADD COLUMN error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER error_stage;
