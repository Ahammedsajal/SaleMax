ALTER TABLE sx_business_notification_settings
  ADD COLUMN retail_orders_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER daily_enabled;

ALTER TABLE sx_business_notification_events
  MODIFY kind ENUM('invoice_issued','payment_due','payment_received','daily_summary','ai_usage_monthly','chatbot_handoff','retail_order_event') NOT NULL;
