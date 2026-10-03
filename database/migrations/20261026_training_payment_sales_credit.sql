-- Keep the agent who owned a lead when its sale was converted. Payment credit
-- must not move if the lead is reassigned or the agent later leaves the team.
ALTER TABLE sx_training_sale_conversions
  ADD COLUMN sales_agent_id BIGINT UNSIGNED NULL AFTER confirmed_by_actor_id,
  ADD COLUMN sales_agent_name VARCHAR(200) NULL AFTER sales_agent_id;
