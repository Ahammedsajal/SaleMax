CREATE TABLE sx_plans (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  next_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_plan_versions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT UNSIGNED NOT NULL,
  category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_version INT UNSIGNED NOT NULL,
  status ENUM('draft','published') NOT NULL DEFAULT 'draft',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  capabilities JSON NOT NULL,
  role_limits JSON NOT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_plan_version (plan_id,version),
  FOREIGN KEY (plan_id) REFERENCES sx_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_plan_assignments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_limits JSON NOT NULL,
  status ENUM('trial','active','grace','expired','suspended','superseded') NOT NULL,
  current_tenant VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status IN ('trial','active','grace','suspended') THEN RTRIM(tenant_id) ELSE NULL END) PERSISTENT,
  effective_from DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_current_assignment (current_tenant),
  KEY idx_sx_assignment_history (tenant_id,created_at),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (plan_version_id) REFERENCES sx_plan_versions(id),
  CHECK (expires_at > effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_team_invites (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_normalized VARCHAR(254) NOT NULL,
  role ENUM('accountant','manager','agent') NOT NULL,
  status ENUM('pending','accepted','cancelled','expired') NOT NULL DEFAULT 'pending',
  reserved_email VARCHAR(254) GENERATED ALWAYS AS (CASE WHEN status='pending' THEN email_normalized ELSE NULL END) PERSISTENT,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sx_invite_request (tenant_id,request_key),
  UNIQUE KEY uq_sx_invite_pending_email (tenant_id,reserved_email),
  KEY idx_sx_invite_seats (tenant_id,role,status,expires_at),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_bin;
