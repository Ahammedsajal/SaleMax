-- Monthly AI cost is an alert threshold only; provider calls are never blocked
-- by this amount. One idempotent reminder is queued per tenant/month.
ALTER TABLE sx_business_notification_events
  MODIFY COLUMN kind ENUM('invoice_issued','payment_due','payment_received','daily_summary','ai_usage_monthly') NOT NULL;

ALTER TABLE sx_chatbot_usage_daily
  MODIFY COLUMN consumed_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN reserved_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE sx_chatbot_usage_monthly (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usage_month DATE NOT NULL,
  input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  estimated_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
  reminder_enqueued_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,usage_month),
  CONSTRAINT sx_chatbot_usage_monthly_tenant_fk FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
