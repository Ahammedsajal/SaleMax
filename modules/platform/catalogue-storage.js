'use strict';

const categoryCatalogue=require('./product-catalog');

// Fixed server-owned adapters. Never accept table names from a tenant or request.
// Product tables keep their historical course_id column until a separately
// reviewed expand/contract migration replaces that compatibility detail.
const adapters=Object.freeze({
 courses:Object.freeze({
  kind:'courses',catalogueTable:'sx_training_courses',offersTable:'sx_training_offers',
  mediaTable:'sx_training_course_media',batchesTable:'sx_training_batches',
  replyJobsTable:'sx_course_reply_jobs',parentIdColumn:'course_id',
  activeItemPredicate:"status='active' AND deleted_at IS NULL"
 }),
 products:Object.freeze({
  kind:'products',catalogueTable:'sx_product_catalog',offersTable:'sx_product_offers',
  mediaTable:'sx_product_media',batchesTable:'sx_product_batches',
  replyJobsTable:'sx_product_reply_jobs',parentIdColumn:'course_id',
  activeItemPredicate:"item_kind IN ('product','service') AND status='active' AND deleted_at IS NULL"
 })
});

function forKind(kind){return adapters[kind]||null;}
function forContext(ctx){const kind=categoryCatalogue.kind(ctx);return kind?forKind(kind):null;}

module.exports={forKind,forContext,adapters};
