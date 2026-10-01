-- GCCBOT QR auth retention clock.
-- Give existing inactive devices a full seven-day grace period because older
-- status polling could have set INACTIVE without recording when it happened.
ALTER TABLE instance ADD COLUMN inactiveSince DATETIME NULL;

UPDATE instance
SET inactiveSince = NOW()
WHERE status = 'INACTIVE' AND inactiveSince IS NULL;

UPDATE instance
SET inactiveSince = NULL
WHERE status <> 'INACTIVE' AND inactiveSince IS NOT NULL;
