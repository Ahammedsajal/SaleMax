-- Reporting validation is category-specific in the transactional service.
-- Sales keeps its manager-plus-leader rule; a small property office can have
-- agents reporting directly to a leader or without a reporting assignment.
ALTER TABLE sx_sales_org_history DROP CONSTRAINT chk_sx_sales_org_leader_requires_manager;
