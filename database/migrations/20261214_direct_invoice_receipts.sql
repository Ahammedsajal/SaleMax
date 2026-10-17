-- An invoice already issued by authorized Finance staff does not require a
-- fabricated Pipeline sale. Preserve all historical sale links and constraints.
ALTER TABLE sx_training_enrollments
 MODIFY sale_review_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 MODIFY lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE sx_training_invoices
 MODIFY sale_review_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE sx_training_generated_invoice_links
 MODIFY sale_review_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;
-- Keep the payment methods already offered in the existing receipt form usable.
ALTER TABLE sx_training_payments
 MODIFY method ENUM('cash','bank_transfer','cheque','other','fawran','pos') NOT NULL;
ALTER TABLE sx_training_receipts
 MODIFY method_snapshot ENUM('cash','bank_transfer','cheque','other','fawran','pos') NOT NULL;
