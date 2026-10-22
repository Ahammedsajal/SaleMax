-- Tenant-owned retail stock ledger. Product records remain in the shared
-- product catalogue contract; quantities and movements are isolated here.
CREATE TABLE sx_retail_locations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_retail_location_tenant_id (tenant_id,id),
  UNIQUE KEY uq_sx_retail_location_code (tenant_id,code),
  KEY idx_sx_retail_location_status (tenant_id,status,code),
  CONSTRAINT fk_sx_retail_location_tenant FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_retail_location_creator FOREIGN KEY (tenant_id,created_by_membership_id,created_by_identity_id) REFERENCES sx_memberships(tenant_id,id,identity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_inventory_balances (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity_on_hand DECIMAL(18,3) NOT NULL DEFAULT 0,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,location_id,product_id),
  KEY idx_sx_retail_balance_product (tenant_id,product_id,location_id),
  CONSTRAINT fk_sx_retail_balance_location FOREIGN KEY (tenant_id,location_id) REFERENCES sx_retail_locations(tenant_id,id),
  CONSTRAINT fk_sx_retail_balance_product FOREIGN KEY (tenant_id,product_id) REFERENCES sx_product_catalog(tenant_id,id),
  CONSTRAINT fk_sx_retail_balance_actor FOREIGN KEY (tenant_id,updated_by_membership_id,updated_by_identity_id) REFERENCES sx_memberships(tenant_id,id,identity_id),
  CONSTRAINT ck_sx_retail_balance_quantity CHECK (quantity_on_hand >= 0),
  CONSTRAINT ck_sx_retail_balance_revision CHECK (revision <= 4294967295)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_stock_movements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity_delta DECIMAL(18,3) NOT NULL,
  quantity_after DECIMAL(18,3) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  reason ENUM('opening_balance','stock_count','correction') NOT NULL,
  note VARCHAR(240) NOT NULL,
  actor_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_retail_movement_tenant_id (tenant_id,id),
  UNIQUE KEY uq_sx_retail_movement_request (tenant_id,request_key),
  UNIQUE KEY uq_sx_retail_movement_revision (tenant_id,location_id,product_id,revision),
  KEY idx_sx_retail_movement_history (tenant_id,location_id,product_id,created_at,id),
  CONSTRAINT fk_sx_retail_movement_location FOREIGN KEY (tenant_id,location_id) REFERENCES sx_retail_locations(tenant_id,id),
  CONSTRAINT fk_sx_retail_movement_product FOREIGN KEY (tenant_id,product_id) REFERENCES sx_product_catalog(tenant_id,id),
  CONSTRAINT fk_sx_retail_movement_actor FOREIGN KEY (tenant_id,actor_membership_id,actor_identity_id) REFERENCES sx_memberships(tenant_id,id,identity_id),
  CONSTRAINT ck_sx_retail_movement_delta CHECK (quantity_delta <> 0),
  CONSTRAINT ck_sx_retail_movement_after CHECK (quantity_after >= 0),
  CONSTRAINT ck_sx_retail_movement_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
