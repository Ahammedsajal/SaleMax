-- WhatsApp reminders require their own customer consent, separate from email consent.
ALTER TABLE sx_training_reminder_preferences
  ADD COLUMN whatsapp_status ENUM('pending','opted_in','opted_out') NOT NULL DEFAULT 'pending' AFTER status,
  ADD COLUMN whatsapp_recipient_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER recipient_hash,
  ADD COLUMN whatsapp_consent_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER consent_version,
  ADD COLUMN whatsapp_consented_at DATETIME(3) NULL AFTER consented_at,
  ADD COLUMN whatsapp_opted_out_at DATETIME(3) NULL AFTER opted_out_at,
  ADD KEY idx_training_reminder_whatsapp (tenant_id,whatsapp_status,updated_at),
  ADD CONSTRAINT ck_training_reminder_whatsapp_consent CHECK (
    (whatsapp_status='opted_in' AND whatsapp_recipient_hash IS NOT NULL AND whatsapp_consent_version IS NOT NULL AND whatsapp_consented_at IS NOT NULL AND whatsapp_opted_out_at IS NULL) OR
    (whatsapp_status='opted_out' AND whatsapp_consent_version IS NULL AND whatsapp_consented_at IS NULL AND whatsapp_opted_out_at IS NOT NULL) OR
    (whatsapp_status='pending' AND whatsapp_consent_version IS NULL AND whatsapp_consented_at IS NULL AND whatsapp_opted_out_at IS NULL)
  );
