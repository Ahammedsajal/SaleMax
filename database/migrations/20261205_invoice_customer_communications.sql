-- Tenant-owned transactional invoice/reminder preferences. No jobs or recipients
-- are created by this migration; delivery is wired separately for new invoices.
CREATE TABLE sx_invoice_customer_communications (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  invoice_email TINYINT(1) NOT NULL DEFAULT 1,
  invoice_whatsapp TINYINT(1) NOT NULL DEFAULT 1,
  reminder_email TINYINT(1) NOT NULL DEFAULT 1,
  reminder_whatsapp TINYINT(1) NOT NULL DEFAULT 1,
  daily_overdue TINYINT(1) NOT NULL DEFAULT 1,
  local_time TIME NOT NULL DEFAULT '09:00:00',
  templates_json JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_invoice_customer_comms_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_invoice_customer_comms_actor FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT ck_invoice_customer_comms_flags CHECK (enabled IN (0,1) AND invoice_email IN (0,1) AND invoice_whatsapp IN (0,1) AND reminder_email IN (0,1) AND reminder_whatsapp IN (0,1) AND daily_overdue IN (0,1)),
  CONSTRAINT ck_invoice_customer_comms_revision CHECK (revision>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
