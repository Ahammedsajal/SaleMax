ALTER TABLE sx_tenant_crm_domains
  ADD COLUMN dns_check_after DATETIME(3) NULL AFTER verification_expires_at,
  ADD COLUMN dns_health_status ENUM('unknown','healthy','stale') NOT NULL DEFAULT 'unknown' AFTER dns_check_after,
  ADD COLUMN dns_last_checked_at DATETIME(3) NULL AFTER dns_health_status;
