ALTER TABLE pipeline_leads
  ADD COLUMN qualification_data JSON NULL AFTER next_follow_up_at;
