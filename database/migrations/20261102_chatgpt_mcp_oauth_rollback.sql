-- Operator-reviewed rollback only. Never apply automatically after customers have connected.
DROP TABLE mcp_oauth_events;
DROP TABLE mcp_tool_idempotency;
DROP TABLE mcp_oauth_tokens;
DROP TABLE mcp_oauth_authorization_codes;
DROP TABLE mcp_oauth_connections;
DROP TABLE mcp_oauth_authorization_transactions;
DROP TABLE mcp_oauth_clients;
