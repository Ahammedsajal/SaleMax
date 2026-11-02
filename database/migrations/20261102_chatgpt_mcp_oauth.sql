CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id VARCHAR(128) NOT NULL,
  client_name VARCHAR(120) NOT NULL,
  client_uri VARCHAR(512) NULL,
  redirect_uris JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (client_id),
  KEY ix_mcp_oauth_clients_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_transactions (
  transaction_hash CHAR(64) NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  redirect_uri VARCHAR(2048) NOT NULL,
  state_value VARCHAR(1024) NOT NULL,
  resource_uri VARCHAR(512) NOT NULL,
  scope_text VARCHAR(512) NOT NULL,
  code_challenge CHAR(43) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (transaction_hash),
  KEY ix_mcp_oauth_transactions_expiry (expires_at),
  CONSTRAINT fk_mcp_oauth_transactions_client FOREIGN KEY (client_id)
    REFERENCES mcp_oauth_clients(client_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_oauth_connections (
  id CHAR(36) NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  source_table ENUM('user','agents') NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  identity_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  legacy_uid_hash CHAR(64) NOT NULL,
  actor_role VARCHAR(32) NOT NULL,
  scope_text VARCHAR(512) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_mcp_oauth_connections_actor (source_table, source_id, tenant_id, revoked_at),
  KEY ix_mcp_oauth_connections_tenant (tenant_id, revoked_at),
  CONSTRAINT fk_mcp_oauth_connections_client FOREIGN KEY (client_id)
    REFERENCES mcp_oauth_clients(client_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (
  code_hash CHAR(64) NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  connection_id CHAR(36) NOT NULL,
  redirect_uri VARCHAR(2048) NOT NULL,
  resource_uri VARCHAR(512) NOT NULL,
  scope_text VARCHAR(512) NOT NULL,
  code_challenge CHAR(43) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (code_hash),
  KEY ix_mcp_oauth_codes_expiry (expires_at),
  CONSTRAINT fk_mcp_oauth_codes_client FOREIGN KEY (client_id)
    REFERENCES mcp_oauth_clients(client_id) ON DELETE RESTRICT,
  CONSTRAINT fk_mcp_oauth_codes_connection FOREIGN KEY (connection_id)
    REFERENCES mcp_oauth_connections(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  token_hash CHAR(64) NOT NULL,
  connection_id CHAR(36) NOT NULL,
  token_family_id CHAR(36) NOT NULL,
  token_type ENUM('access','refresh') NOT NULL,
  resource_uri VARCHAR(512) NOT NULL,
  scope_text VARCHAR(512) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (token_hash),
  KEY ix_mcp_oauth_tokens_connection (connection_id, token_type, revoked_at, expires_at),
  KEY ix_mcp_oauth_tokens_family (token_family_id, token_type, revoked_at),
  KEY ix_mcp_oauth_tokens_expiry (expires_at),
  CONSTRAINT fk_mcp_oauth_tokens_connection FOREIGN KEY (connection_id)
    REFERENCES mcp_oauth_connections(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_tool_idempotency (
  connection_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  result_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (connection_id, idempotency_key),
  KEY ix_mcp_tool_idempotency_expiry (expires_at),
  CONSTRAINT fk_mcp_tool_idempotency_connection FOREIGN KEY (connection_id)
    REFERENCES mcp_oauth_connections(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_oauth_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  connection_id CHAR(36) NULL,
  client_id VARCHAR(128) NULL,
  event_type VARCHAR(48) NOT NULL,
  tool_name VARCHAR(80) NULL,
  resource_id VARCHAR(191) NULL,
  outcome VARCHAR(32) NOT NULL,
  details_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_mcp_oauth_events_connection (connection_id, created_at),
  KEY ix_mcp_oauth_events_created (created_at),
  CONSTRAINT fk_mcp_oauth_events_connection FOREIGN KEY (connection_id)
    REFERENCES mcp_oauth_connections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mcp_oauth_events_client FOREIGN KEY (client_id)
    REFERENCES mcp_oauth_clients(client_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
