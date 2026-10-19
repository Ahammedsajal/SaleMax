-- Keep every legacy database timezone default aligned with SaleMaX system time.
ALTER TABLE broadcast ALTER timezone SET DEFAULT 'Asia/Qatar';
ALTER TABLE beta_campaign ALTER timezone SET DEFAULT 'Asia/Qatar';
ALTER TABLE sx_training_report_runs ALTER timezone SET DEFAULT 'Asia/Qatar';
