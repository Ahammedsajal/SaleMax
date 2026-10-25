-- Permit multiple verified hostnames for one business and enforce at most
-- one primary hostname. NULL values are intentionally repeatable in MariaDB's
-- unique index, so every alias except the primary keeps is_primary=NULL.
ALTER TABLE sx_tenant_crm_domains
  ADD COLUMN is_primary TINYINT(1) NULL DEFAULT NULL AFTER hostname;

UPDATE sx_tenant_crm_domains d
JOIN (SELECT tenant_id,MIN(id) AS id FROM sx_tenant_crm_domains
      WHERE status IN ('verified','active') GROUP BY tenant_id) first_domain
  ON first_domain.tenant_id=d.tenant_id AND first_domain.id=d.id
SET d.is_primary=1;

ALTER TABLE sx_tenant_crm_domains
  DROP INDEX uq_sx_tenant_crm_domains_one_current,
  ADD UNIQUE KEY uq_sx_tenant_crm_domains_tenant_primary (tenant_id,is_primary);
