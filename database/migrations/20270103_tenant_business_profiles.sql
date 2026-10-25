-- Shared business identity for CRM and verified customer-domain branding.
CREATE TABLE sx_tenant_business_profiles (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_name_en VARCHAR(200) NOT NULL DEFAULT '',
  business_name_ar VARCHAR(200) NOT NULL DEFAULT '',
  cr_number VARCHAR(100) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  phone VARCHAR(80) NOT NULL DEFAULT '',
  website_url VARCHAR(2048) NOT NULL DEFAULT '',
  address_en VARCHAR(1000) NOT NULL DEFAULT '',
  address_ar VARCHAR(1000) NOT NULL DEFAULT '',
  google_maps_url VARCHAR(2048) NOT NULL DEFAULT '',
  logo_url VARCHAR(2048) NOT NULL DEFAULT '',
  favicon_url VARCHAR(2048) NOT NULL DEFAULT '',
  meta_title_en VARCHAR(200) NOT NULL DEFAULT '',
  meta_title_ar VARCHAR(200) NOT NULL DEFAULT '',
  meta_description_en VARCHAR(500) NOT NULL DEFAULT '',
  meta_description_ar VARCHAR(500) NOT NULL DEFAULT '',
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_sx_tenant_business_profiles_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_tenant_business_profiles_updater FOREIGN KEY (updated_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Keep the currently used CRM logo/revision compatible during the transition.
INSERT INTO sx_tenant_business_profiles (tenant_id,logo_url,revision,updated_by_identity_id,updated_at)
SELECT tenant_id,logo_url,revision,updated_by_identity_id,updated_at
FROM sx_tenant_crm_branding;

-- Seed common fields from existing Training Center profiles where no CRM-wide
-- value exists. Invoice-specific fields remain in the existing profile table.
INSERT INTO sx_tenant_business_profiles
  (tenant_id,business_name_en,business_name_ar,cr_number,email,phone,website_url,address_en,address_ar,
   google_maps_url,logo_url,revision,updated_by_identity_id,updated_at)
SELECT p.tenant_id,p.display_name_en,p.display_name_ar,p.cr_number,p.email,p.phone,p.website_url,
       p.address_en,p.address_ar,p.google_maps_url,
       IF(COALESCE(c.logo_url,'')<>'',c.logo_url,p.logo_url),p.revision,p.updated_by_identity_id,p.updated_at
FROM sx_training_center_profiles p
LEFT JOIN sx_tenant_crm_branding c ON c.tenant_id=p.tenant_id
ON DUPLICATE KEY UPDATE
  business_name_en=IF(sx_tenant_business_profiles.business_name_en='',VALUES(business_name_en),sx_tenant_business_profiles.business_name_en),
  business_name_ar=IF(sx_tenant_business_profiles.business_name_ar='',VALUES(business_name_ar),sx_tenant_business_profiles.business_name_ar),
  cr_number=IF(sx_tenant_business_profiles.cr_number='',VALUES(cr_number),sx_tenant_business_profiles.cr_number),
  email=IF(sx_tenant_business_profiles.email='',VALUES(email),sx_tenant_business_profiles.email),
  phone=IF(sx_tenant_business_profiles.phone='',VALUES(phone),sx_tenant_business_profiles.phone),
  website_url=IF(sx_tenant_business_profiles.website_url='',VALUES(website_url),sx_tenant_business_profiles.website_url),
  address_en=IF(sx_tenant_business_profiles.address_en='',VALUES(address_en),sx_tenant_business_profiles.address_en),
  address_ar=IF(sx_tenant_business_profiles.address_ar='',VALUES(address_ar),sx_tenant_business_profiles.address_ar),
  google_maps_url=IF(sx_tenant_business_profiles.google_maps_url='',VALUES(google_maps_url),sx_tenant_business_profiles.google_maps_url),
  logo_url=IF(sx_tenant_business_profiles.logo_url='',VALUES(logo_url),sx_tenant_business_profiles.logo_url);
