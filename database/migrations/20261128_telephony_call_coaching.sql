CREATE TABLE sx_telephony_call_coaching (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  call_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  agent_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coach_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quality ENUM('effective','needs_improvement','follow_up_required') NOT NULL,
  feedback VARCHAR(3000) NOT NULL,
  next_action VARCHAR(500) NULL,
  visible_to_agent TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,id),
  KEY idx_sx_call_coaching_call (tenant_id,call_id,created_at,id),
  KEY idx_sx_call_coaching_agent (tenant_id,agent_membership_id,created_at,id),
  CONSTRAINT fk_sx_call_coaching_call FOREIGN KEY (tenant_id,call_id) REFERENCES sx_telephony_calls(tenant_id,id),
  CONSTRAINT fk_sx_call_coaching_agent FOREIGN KEY (tenant_id,agent_membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT fk_sx_call_coaching_coach FOREIGN KEY (tenant_id,coach_membership_id) REFERENCES sx_memberships(tenant_id,id),
  CONSTRAINT ck_sx_call_coaching_visible CHECK (visible_to_agent IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
