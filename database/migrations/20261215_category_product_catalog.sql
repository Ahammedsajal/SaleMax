-- Separate empty Sales catalogue; Training Center records stay in place.
CREATE TABLE sx_product_catalog LIKE sx_training_courses;
CREATE TABLE sx_product_offers LIKE sx_training_offers;
CREATE TABLE sx_product_media LIKE sx_training_course_media;
CREATE TABLE sx_product_batches LIKE sx_training_batches;
CREATE TABLE sx_product_reply_jobs LIKE sx_course_reply_jobs;
UPDATE sx_plan_versions SET capabilities=JSON_ARRAY_APPEND(capabilities,'$','products.catalog') WHERE category_key='salemax_sales' AND JSON_CONTAINS(capabilities,JSON_QUOTE('products.catalog'))=0;
