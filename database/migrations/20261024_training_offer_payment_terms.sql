-- Reusable per-offer payment terms. Existing price versions retain the safe
-- one-payment default; new sale schedules snapshot the configured terms.
ALTER TABLE sx_training_offers
  ADD COLUMN payment_term_count TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER registration_fee_minor,
  ADD COLUMN payment_interval ENUM('once','weekly','monthly') NOT NULL DEFAULT 'once' AFTER payment_term_count,
  ADD CONSTRAINT ck_training_offer_payment_terms CHECK (
    payment_term_count BETWEEN 1 AND 12 AND
    ((payment_term_count = 1 AND payment_interval = 'once') OR
     (payment_term_count > 1 AND payment_interval IN ('weekly','monthly')))
  );

-- Preserve who actually completed an approved sale, including legacy agents
-- who do not have a canonical identity row of their own.
ALTER TABLE sx_training_sale_conversions
  ADD COLUMN confirmed_by_actor_type ENUM('identity','agent') NOT NULL DEFAULT 'identity' AFTER confirmed_by_identity_id,
  ADD COLUMN confirmed_by_actor_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER confirmed_by_actor_type;

-- The only agent-approved sale is the zero-discount offer exactly as published.
ALTER TABLE sx_training_sale_reviews
  MODIFY COLUMN decided_by_role ENUM('owner','manager','accountant','agent') NULL;
