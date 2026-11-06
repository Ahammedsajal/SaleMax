CREATE TABLE sx_retail_locations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NOT NULL DEFAULT '',
  address VARCHAR(500) NOT NULL DEFAULT '',
  map_pin VARCHAR(48) DEFAULT NULL,
  accepts_pickup TINYINT(1) NOT NULL DEFAULT 1,
  accepts_delivery TINYINT(1) NOT NULL DEFAULT 1,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  active_default TINYINT AS (CASE WHEN status='active' AND is_default=1 THEN 1 ELSE NULL END) PERSISTENT,
  PRIMARY KEY (id),
  UNIQUE KEY uq_retail_location_code (tenant_id,code),
  UNIQUE KEY uq_retail_location_tenant_id (tenant_id,id),
  UNIQUE KEY uq_retail_location_active_default (tenant_id,active_default),
  KEY ix_retail_location_active (tenant_id,status,is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sx_retail_locations (id,tenant_id,code,name_en,name_ar,is_default,status)
SELECT LOWER(UUID()),tenant_id,'main','Main location','الموقع الرئيسي',1,'active'
FROM (
  SELECT id AS tenant_id FROM sx_tenants WHERE category_key='retail_boutique'
  UNION
  SELECT DISTINCT tenant_id FROM sx_business_stock_movements
) inventory_tenants;

ALTER TABLE sx_business_stock_movements
  ADD COLUMN location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;

UPDATE sx_business_stock_movements m
JOIN sx_retail_locations l ON l.tenant_id=m.tenant_id AND l.is_default=1 AND l.status='active'
SET m.location_id=l.id;

ALTER TABLE sx_business_stock_movements
  MODIFY location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  DROP INDEX uq_business_stock_request,
  ADD UNIQUE KEY uq_business_stock_request (tenant_id,product_id,location_id,request_id),
  DROP INDEX ix_business_stock_history,
  ADD KEY ix_business_stock_history (tenant_id,product_id,location_id,id),
  ADD CONSTRAINT fk_business_stock_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES sx_retail_locations (tenant_id,id);

ALTER TABLE sx_retail_stock_reservations
  ADD COLUMN location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;

UPDATE sx_retail_stock_reservations r
JOIN sx_retail_locations l ON l.tenant_id=r.tenant_id AND l.is_default=1 AND l.status='active'
SET r.location_id=l.id;

ALTER TABLE sx_retail_stock_reservations
  MODIFY location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (tenant_id,product_id,location_id,order_id),
  ADD KEY ix_retail_reservation_location (tenant_id,location_id,product_id,order_id),
  ADD CONSTRAINT fk_retail_reservation_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES sx_retail_locations (tenant_id,id);

ALTER TABLE sx_retail_orders
  ADD COLUMN location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;

UPDATE sx_retail_orders o
JOIN sx_retail_locations l ON l.tenant_id=o.tenant_id AND l.is_default=1 AND l.status='active'
SET o.location_id=l.id;

ALTER TABLE sx_retail_orders
  MODIFY location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD KEY ix_retail_order_location_queue (tenant_id,location_id,status,created_at),
  ADD CONSTRAINT fk_retail_order_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES sx_retail_locations (tenant_id,id);

CREATE TABLE sx_retail_variant_groups (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title_en VARCHAR(160) NOT NULL,
  title_ar VARCHAR(160) NOT NULL DEFAULT '',
  option_label_en VARCHAR(80) NOT NULL,
  option_label_ar VARCHAR(80) NOT NULL DEFAULT '',
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_retail_variant_group_tenant_id (tenant_id,id),
  KEY ix_retail_variant_group_tenant (tenant_id,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_variant_products (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  value_en VARCHAR(100) NOT NULL,
  value_ar VARCHAR(100) NOT NULL DEFAULT '',
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,product_id),
  UNIQUE KEY uq_retail_variant_order (tenant_id,group_id,sort_order),
  KEY ix_retail_variant_group (tenant_id,group_id,sort_order),
  CONSTRAINT fk_retail_variant_group FOREIGN KEY (tenant_id,group_id)
    REFERENCES sx_retail_variant_groups (tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_retail_variant_listing FOREIGN KEY (tenant_id,product_id)
    REFERENCES sx_retail_listings (tenant_id,product_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sx_retail_stock_transfers (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  reason VARCHAR(200) NOT NULL,
  actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_retail_stock_transfer_request (tenant_id,request_id),
  KEY ix_retail_stock_transfer_history (tenant_id,product_id,created_at),
  CONSTRAINT fk_retail_transfer_source FOREIGN KEY (tenant_id,source_location_id)
    REFERENCES sx_retail_locations (tenant_id,id),
  CONSTRAINT fk_retail_transfer_target FOREIGN KEY (tenant_id,target_location_id)
    REFERENCES sx_retail_locations (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
