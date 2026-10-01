CREATE TABLE sx_tenants (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(200) NOT NULL,
  category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_version INT UNSIGNED NOT NULL,
  country_code CHAR(2) CHARACTER SET ascii NOT NULL DEFAULT 'QA',
  currency CHAR(3) CHARACTER SET ascii NOT NULL DEFAULT 'QAR',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Qatar',
  status ENUM('provisioning','active','suspended','archived') NOT NULL DEFAULT 'provisioning',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_sx_tenant_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_identities (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_normalized VARCHAR(254) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  password_hash VARCHAR(255) NULL,
  status ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending',
  credential_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_sx_identity_email (email_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE sx_memberships (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role ENUM('owner','accountant','manager','agent') NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  permission_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  delegated_permissions JSON NOT NULL DEFAULT ('[]'),
  active_owner_tenant VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN role='owner' AND status='active' THEN RTRIM(tenant_id) ELSE NULL END) PERSISTENT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_sx_membership_identity (tenant_id,identity_id),
  UNIQUE KEY uq_sx_membership_tenant_id (tenant_id,id),
  UNIQUE KEY uq_sx_membership_context (tenant_id,id,identity_id),
  UNIQUE KEY uq_sx_active_owner (active_owner_tenant),
  KEY idx_sx_membership_seats (tenant_id,role,status),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_platform_memberships (
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role ENUM('super_admin','staff') NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  delegated_permissions JSON NOT NULL DEFAULT ('[]'),
  permission_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  owner_guard TINYINT GENERATED ALWAYS AS (CASE WHEN role='super_admin' AND status='active' THEN 1 ELSE NULL END) PERSISTENT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (identity_id), UNIQUE KEY uq_sx_platform_owner (owner_guard),
  FOREIGN KEY (identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience ENUM('tenant','platform') NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  credential_version BIGINT UNSIGNED NOT NULL,
  authenticated_at DATETIME(3) NOT NULL,
  mfa_verified_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_sx_session_hash (token_hash),
  KEY idx_sx_session_identity (identity_id,revoked_at,expires_at),
  FOREIGN KEY (identity_id) REFERENCES sx_identities(id),
  FOREIGN KEY (tenant_id,membership_id,identity_id) REFERENCES sx_memberships(tenant_id,id,identity_id),
  CONSTRAINT ck_sx_session_audience CHECK ((audience='tenant' AND tenant_id IS NOT NULL AND membership_id IS NOT NULL) OR (audience='platform' AND tenant_id IS NULL AND membership_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_legacy_ownership (
  source_table VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  legacy_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  verified_at DATETIME(3) NOT NULL,
  PRIMARY KEY (source_table,source_id),
  KEY idx_sx_legacy_tenant (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (tenant_id,membership_id) REFERENCES sx_memberships(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_audit_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_kind ENUM('identity','system') NOT NULL,
  action VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id VARCHAR(191) NOT NULL,
  reason VARCHAR(1000) NULL,
  changes JSON NOT NULL,
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), KEY idx_sx_audit_tenant (tenant_id,occurred_at,id),
  FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_sx_audit_actor CHECK ((actor_kind='identity' AND actor_identity_id IS NOT NULL) OR (actor_kind='system' AND actor_identity_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
