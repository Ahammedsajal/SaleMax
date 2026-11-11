ALTER TABLE sx_pipeline_followup_assignment_settings
  ADD COLUMN eligible_agent_ids_json JSON NULL AFTER enabled;
