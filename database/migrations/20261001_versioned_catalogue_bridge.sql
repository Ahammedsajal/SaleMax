-- Explicit links to the existing catalogue; never backfill or reassign silently.
CREATE TABLE sx_legacy_plan_catalogue (
  legacy_plan_id INT NOT NULL PRIMARY KEY,
  plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UNIQUE KEY uq_sx_catalogue_plan (plan_id),
  FOREIGN KEY (plan_id) REFERENCES sx_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_legacy_plan_contracts (
  version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  legacy_plan_id INT NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  commercial_snapshot JSON NOT NULL,
  definition_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  commercial_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_catalogue_draft_request (request_id),
  KEY idx_sx_catalogue_contract (legacy_plan_id,created_at),
  FOREIGN KEY (version_id) REFERENCES sx_plan_versions(id),
  FOREIGN KEY (legacy_plan_id) REFERENCES sx_legacy_plan_catalogue(legacy_plan_id),
  FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
