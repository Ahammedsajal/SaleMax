-- Enforce one QR session owner even when two application workers create the
-- same caller-supplied ID concurrently. The 150-character prefix matches the
-- existing bounded index and application input limit.
ALTER TABLE instance ADD UNIQUE INDEX uq_instance_uniqueid (uniqueId(150));
