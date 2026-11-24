CREATE TABLE sx_email_sender_domain_shares (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  domain_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  shared_tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('active','revoked') NOT NULL DEFAULT 'active',
  created_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revoked_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sx_email_domain_share (domain_id,shared_tenant_id,sender_email),
  KEY idx_sx_email_domain_share_target (shared_tenant_id,status,domain_id),
  CONSTRAINT fk_sx_email_domain_share_owner FOREIGN KEY (owner_tenant_id,domain_id) REFERENCES sx_email_sender_domains(tenant_id,id),
  CONSTRAINT fk_sx_email_domain_share_target FOREIGN KEY (shared_tenant_id) REFERENCES sx_tenants(id),
  CONSTRAINT fk_sx_email_domain_share_creator FOREIGN KEY (created_by_identity_id) REFERENCES sx_identities(id),
  CONSTRAINT fk_sx_email_domain_share_revoker FOREIGN KEY (revoked_by_identity_id) REFERENCES sx_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sx_email_senders DROP FOREIGN KEY fk_sx_email_sender_domain;
ALTER TABLE sx_email_senders
  ADD CONSTRAINT fk_sx_email_sender_domain FOREIGN KEY (domain_id) REFERENCES sx_email_sender_domains(id);
