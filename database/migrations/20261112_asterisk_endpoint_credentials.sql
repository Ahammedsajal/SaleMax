ALTER TABLE sx_telephony_extensions
  ADD COLUMN mobile_credential_revision BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER revision,
  ADD COLUMN browser_credential_revision BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER mobile_credential_revision,
  ADD CONSTRAINT ck_sx_telephony_endpoint_credential_revisions CHECK (mobile_credential_revision >= 1 AND browser_credential_revision >= 1);
