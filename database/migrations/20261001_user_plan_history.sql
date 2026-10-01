-- Legacy assignment compatibility history. Canonical ownership/version mapping
-- is reviewed separately; this preserves existing user IDs and plan snapshots.
CREATE TABLE sx_legacy_plan_assignments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_uid VARCHAR(999) NOT NULL,
  owner_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_uid VARCHAR(999) NOT NULL,
  plan_id INT UNSIGNED NOT NULL,
  previous_snapshot LONGTEXT NULL,
  previous_expiry VARCHAR(999) NULL,
  assigned_snapshot JSON NOT NULL,
  assigned_expiry BIGINT UNSIGNED NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_legacy_assignment_request (request_id),
  KEY idx_sx_legacy_assignment_owner (owner_uid_hash, assigned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
