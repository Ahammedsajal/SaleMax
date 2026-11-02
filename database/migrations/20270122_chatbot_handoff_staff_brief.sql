ALTER TABLE sx_chatbot_handoff_claims
  ADD COLUMN customer_name VARCHAR(160) NULL AFTER reason,
  ADD COLUMN customer_phone VARCHAR(32) NULL AFTER customer_name,
  ADD COLUMN course_details JSON NULL AFTER customer_phone,
  ADD COLUMN latest_enquiry VARCHAR(1000) NULL AFTER course_details,
  ADD COLUMN summary_context JSON NULL AFTER latest_enquiry,
  ADD COLUMN ai_summary VARCHAR(600) NULL AFTER summary_context,
  ADD COLUMN ai_summary_status ENUM('pending','working','ready','fallback') NOT NULL DEFAULT 'pending' AFTER ai_summary,
  ADD COLUMN ai_summary_lease_until DATETIME(3) NULL AFTER ai_summary_status,
  ADD COLUMN ai_summary_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER ai_summary_lease_until;
