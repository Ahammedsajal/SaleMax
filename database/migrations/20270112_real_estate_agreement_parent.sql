-- Tie a downstream brokerage/referral agreement to the active owner authority
-- that permits it. Null remains valid for root owner/management agreements.
ALTER TABLE sx_real_estate_agreements
  ADD COLUMN parent_agreement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER contact_id,
  ADD KEY idx_sx_re_agreement_parent(tenant_id,parent_agreement_id,status),
  ADD CONSTRAINT fk_sx_re_agreement_parent FOREIGN KEY(tenant_id,parent_agreement_id) REFERENCES sx_real_estate_agreements(tenant_id,id);
