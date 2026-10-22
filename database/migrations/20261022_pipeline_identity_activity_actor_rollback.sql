-- Run only after confirming no canonical identity activities remain:
-- SELECT COUNT(*) FROM pipeline_activity WHERE actor_type='identity';
-- The count must be zero before applying this schema rollback.
ALTER TABLE pipeline_activity
  MODIFY actor_type ENUM('user','agent','system') NOT NULL DEFAULT 'system';
