-- Keep invoice identity and footer in the tenant's canonical business profile.
ALTER TABLE sx_training_center_profiles
  ADD COLUMN legal_name VARCHAR(200) NOT NULL DEFAULT '' AFTER display_name_ar,
  ADD COLUMN invoice_footer VARCHAR(1000) NOT NULL DEFAULT '' AFTER invoice_prefix;

UPDATE sx_training_center_profiles p
LEFT JOIN sx_invoice_generator_settings s ON s.tenant_id=p.tenant_id
SET p.legal_name=IF(p.legal_name='',p.display_name_en,p.legal_name),
    p.invoice_footer=IF(p.invoice_footer='',COALESCE(s.footer,''),p.invoice_footer);

-- Restore the established reminder defaults. Customer consent and provider gates
-- remain enforced by the reminder workflow.
ALTER TABLE sx_training_reminder_settings
  ALTER COLUMN enabled SET DEFAULT 1;

UPDATE sx_training_reminder_settings
SET enabled=1,revision=revision+1
WHERE enabled=0;
