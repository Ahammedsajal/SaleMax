-- Canonical workspace members can create Pipeline leads without a legacy user row.
ALTER TABLE pipeline_activity
  MODIFY actor_type ENUM('user','agent','identity','system') NOT NULL DEFAULT 'system';
