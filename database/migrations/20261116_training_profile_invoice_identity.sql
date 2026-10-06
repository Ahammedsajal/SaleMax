-- Keep center identity and invoice numbering in one owner-managed profile.
ALTER TABLE sx_training_center_profiles
  ADD COLUMN cr_number VARCHAR(100) NOT NULL DEFAULT '' AFTER address_ar,
  ADD COLUMN invoice_prefix VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INV' AFTER cr_number;

-- Preserve existing invoice setup before the duplicate controls are removed.
UPDATE sx_training_center_profiles p
JOIN sx_invoice_generator_settings s ON s.tenant_id=p.tenant_id
SET p.cr_number=IF(p.cr_number='',s.cr_number,p.cr_number),
    p.invoice_prefix=IF(p.invoice_prefix='INV',s.invoice_prefix,p.invoice_prefix);

INSERT INTO sx_invoice_generator_settings
  (tenant_id,company_name,cr_number,company_address,footer,logo_data_url,invoice_prefix,payment_plans,updated_by_identity_id)
SELECT p.tenant_id,p.display_name_en,p.cr_number,p.address_en,'',NULL,p.invoice_prefix,
       JSON_ARRAY(JSON_OBJECT('id','full','label','Full payment','installments',1,'intervalDays',0),JSON_OBJECT('id','monthly-2','label','2 monthly payments','installments',2,'intervalDays',30),JSON_OBJECT('id','monthly-3','label','3 monthly payments','installments',3,'intervalDays',30),JSON_OBJECT('id','monthly-6','label','6 monthly payments','installments',6,'intervalDays',30)),p.updated_by_identity_id
FROM sx_training_center_profiles p
LEFT JOIN sx_invoice_generator_settings s ON s.tenant_id=p.tenant_id
WHERE s.tenant_id IS NULL;

-- New training invoices use the profile fields and fixed no-tax setup. Nullable snapshots preserve historical foreign-key checks.
ALTER TABLE sx_training_invoices
  MODIFY finance_policy_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY finance_policy_version INT UNSIGNED NULL,
  MODIFY finance_policy_approved_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;
